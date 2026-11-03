// Server to server postbacks and URL macros, the way an ad tracker uses them: a click gets an id and sub ids, the offer link carries {clickid} style macros, and the network calls our
// postback URL back with the same macros filled in once a lead or a sale happens. Stored once per (click, status, transaction): a network that fires the same postback twice never counts twice.
import { randomUUID, timingSafeEqual } from "node:crypto";
import type { Ledger } from "./ledger.ts";

/** Every macro a link or a postback URL may carry. Anything else in braces is refused, never silently left in a URL. */
export const MACROS = ["clickid", "sub1", "sub2", "sub3", "payout", "currency", "status", "txid"] as const;
export type Macro = (typeof MACROS)[number];
export const STATUSES = ["lead", "sale", "reject", "hold"] as const;
export type PostbackStatus = (typeof STATUSES)[number];

const MACRO_TOKEN = /\{([a-z0-9_]+)\}/gi;

/** Fills {macro} tokens in a URL template. A value is URL-encoded, a missing one becomes empty, and a name outside MACROS throws: a typo in a link must fail where it is written, not at a network. */
export function expandMacros(template: string, values: Partial<Record<Macro, string | number>>): string {
  return template.replace(MACRO_TOKEN, (_all, raw: string) => {
    const name = raw.toLowerCase() as Macro;
    if (!(MACROS as readonly string[]).includes(name)) throw new Error(`unknown macro {${raw}}`);
    const v = values[name];
    return v === undefined || v === null ? "" : encodeURIComponent(String(v));
  });
}

/** The macros a template uses, in order, without repeats. */
export function macrosIn(template: string): string[] {
  return [...new Set([...template.matchAll(MACRO_TOKEN)].map((m) => m[1].toLowerCase()))];
}

export interface ClickInput { offer: string; sub1?: string; sub2?: string; sub3?: string; landingUrl?: string; variant?: number }
export interface OfferVariant { url: string; weight: number }

/** Weighted offer rotation: one random draw over the weights. A weight must be a positive finite number and a list must not be empty, so a typo in the config fails where it is written, never as a silent 100 percent to the first link. */
export function pickVariant(variants: readonly OfferVariant[], rnd: () => number = Math.random): number {
  if (!variants.length) throw new Error("an offer needs at least one link");
  for (const v of variants) if (!Number.isFinite(v.weight) || v.weight <= 0) throw new Error(`bad weight ${v.weight}: use a positive number`);
  const total = variants.reduce((n, v) => n + v.weight, 0);
  let x = rnd() * total;
  for (let i = 0; i < variants.length; i++) { x -= variants[i].weight; if (x < 0) return i; }
  return variants.length - 1; // rnd() is below 1, so this is only reached by rounding at the very top of the range
}
export interface PostbackInput { clickid?: string; status?: string; payout?: string | number; currency?: string; txid?: string }
export type PostbackResult =
  | { ok: true; inserted: boolean; id: number }
  | { ok: false; error: "bad_clickid" | "unknown_click" | "bad_status" | "bad_payout" | "bad_currency" | "bad_txid" | "outside_window" | "reject_is_final" | "hold_after_sale" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const short = (v: string | undefined, n: number) => (v ?? "").replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ").trim().slice(0, n);

export class PostbackStore {
  private ledger: Ledger;
  private attributionDays: number;
  /** attributionDays: a conversion that arrives more than this many days after its click is refused (networks and ad platforms stop counting a click after a window). */
  constructor(ledger: Ledger, attributionDays = 30) {
    if (!Number.isFinite(attributionDays) || attributionDays <= 0) throw new Error("attributionDays must be a positive number");
    this.ledger = ledger;
    this.attributionDays = attributionDays;
    // COPY-OK: SQL, not screen text
    this.ledger.db.exec(`
      CREATE TABLE IF NOT EXISTS clicks (
        clickid TEXT PRIMARY KEY, created_at TEXT NOT NULL, offer TEXT NOT NULL, sub1 TEXT, sub2 TEXT, sub3 TEXT, landing_url TEXT, variant INTEGER
      );
      CREATE TABLE IF NOT EXISTS conversions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, clickid TEXT NOT NULL REFERENCES clicks(clickid), status TEXT NOT NULL CHECK (status IN ('lead','sale','reject','hold')),
        payout REAL NOT NULL CHECK (payout >= 0), currency TEXT NOT NULL, txid TEXT NOT NULL DEFAULT '', received_at TEXT NOT NULL,
        UNIQUE (clickid, status, txid)
      );
    `);
    // a database made before rotation existed gets the column added
    const cols = this.ledger.db.prepare("PRAGMA table_info(clicks)").all() as { name: string }[];
    if (!cols.some((c) => c.name === "variant")) this.ledger.db.exec("ALTER TABLE clicks ADD COLUMN variant INTEGER");
  }

  /** A new click: the id is ours (a random UUID), so a network can only ever echo back one we issued. */
  newClick(c: ClickInput, now = new Date()): string {
    const id = randomUUID();
    // COPY-OK: SQL, not screen text
    this.ledger.db.prepare("INSERT INTO clicks (clickid, created_at, offer, sub1, sub2, sub3, landing_url, variant) VALUES (?,?,?,?,?,?,?,?)")
      .run(id, now.toISOString(), short(c.offer, 80), short(c.sub1, 100) || null, short(c.sub2, 100) || null, short(c.sub3, 100) || null, short(c.landingUrl, 500) || null, Number.isInteger(c.variant) ? (c.variant as number) : null);
    return id;
  }

  /** The postback itself. Validated first, stored second; the same (click, status, txid) a second time reads "already stored". */
  record(p: PostbackInput, now = new Date()): PostbackResult {
    const clickid = short(p.clickid, 64);
    if (!UUID.test(clickid)) return { ok: false, error: "bad_clickid" };
    const status = short(p.status, 20).toLowerCase();
    if (!(STATUSES as readonly string[]).includes(status)) return { ok: false, error: "bad_status" };
    const payoutText = String(p.payout ?? "0").trim() || "0";
    const payout = /^\d{1,9}(\.\d{1,4})?$/.test(payoutText) ? Number(payoutText) : NaN;
    if (!Number.isFinite(payout)) return { ok: false, error: "bad_payout" };
    const currency = short(p.currency, 3).toUpperCase() || "USD";
    if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, error: "bad_currency" };
    if (p.txid !== undefined && String(p.txid).length > 80) return { ok: false, error: "bad_txid" };
    const txid = short(p.txid, 80);
    const click = this.ledger.db.prepare("SELECT created_at FROM clicks WHERE clickid = ?").get(clickid) as { created_at: string } | undefined;
    if (!click) return { ok: false, error: "unknown_click" };
    if (now.getTime() - Date.parse(click.created_at) > this.attributionDays * 86_400_000) return { ok: false, error: "outside_window" };
    // lifecycle: a reject is final, and a hold means "not decided yet" so it cannot follow a sale. A sale later reversed to reject is allowed (a chargeback).
    const seen = (this.ledger.db.prepare("SELECT DISTINCT status FROM conversions WHERE clickid = ?").all(clickid) as { status: string }[]).map((r) => r.status);
    if (seen.includes("reject") && status !== "reject") return { ok: false, error: "reject_is_final" };
    if (seen.includes("sale") && status === "hold") return { ok: false, error: "hold_after_sale" };
    // ON CONFLICT, not check then insert: two copies of one postback arriving together must both read a clean answer
    // COPY-OK: SQL, not screen text
    const r = this.ledger.db.prepare("INSERT INTO conversions (clickid, status, payout, currency, txid, received_at) VALUES (?,?,?,?,?,?) ON CONFLICT (clickid, status, txid) DO NOTHING")
      .run(clickid, status, payout, currency, txid, now.toISOString());
    if (Number(r.changes) === 0) {
      const row = this.ledger.db.prepare("SELECT id FROM conversions WHERE clickid = ? AND status = ? AND txid = ?").get(clickid, status, txid) as { id: number };
      return { ok: true, inserted: false, id: row.id };
    }
    return { ok: true, inserted: true, id: Number(r.lastInsertRowid) };
  }

  /** What the network lists versus what we stored: rows we hold that its export lacks, and rows its export has that we never received (a lost postback). */
  reconcile(networkRows: { clickid: string; status: string; txid?: string }[]): { missingAtNetwork: number; missingHere: { clickid: string; status: string; txid: string }[] } {
    const key = (c: string, s: string, t: string) => `${c}|${s.toLowerCase()}|${t}`;
    const theirs = new Set(networkRows.map((r) => key(r.clickid, r.status, r.txid ?? "")));
    const ours = this.ledger.db.prepare("SELECT clickid, status, txid FROM conversions").all() as { clickid: string; status: string; txid: string }[];
    const oursSet = new Set(ours.map((r) => key(r.clickid, r.status, r.txid)));
    return {
      missingAtNetwork: ours.filter((r) => !theirs.has(key(r.clickid, r.status, r.txid))).length,
      missingHere: networkRows.filter((r) => !oursSet.has(key(r.clickid, r.status, r.txid ?? ""))).map((r) => ({ clickid: r.clickid, status: r.status, txid: r.txid ?? "" })),
    };
  }

  /** Totals per sub1 and status, the report a media buyer reads. */
  report(): { sub1: string; status: string; conversions: number; payout: number }[] {
    // COPY-OK: SQL, not screen text
    const sql = "SELECT COALESCE(c.sub1, '') AS sub1, v.status AS status, COUNT(*) AS conversions, ROUND(SUM(v.payout), 4) AS payout "
      + "FROM conversions v JOIN clicks c ON c.clickid = v.clickid GROUP BY c.sub1, v.status ORDER BY c.sub1, v.status";
    return (this.ledger.db.prepare(sql).all() as { sub1: string; status: string; conversions: number; payout: number }[]).map((r) => ({ ...r }));   // plain objects: the driver returns null-prototype rows
  }

  /** Per offer and variant: clicks, conversions and payout, so a rotation can be judged. A variant with clicks and no conversion still appears (zero), because that is the one to look at. */
  reportByVariant(): { offer: string; variant: number | null; clicks: number; conversions: number; payout: number }[] {
    // COPY-OK: SQL, not screen text
    const sql = "SELECT c.offer AS offer, c.variant AS variant, COUNT(DISTINCT c.clickid) AS clicks, COUNT(v.id) AS conversions, ROUND(COALESCE(SUM(v.payout), 0), 4) AS payout "
      + "FROM clicks c LEFT JOIN conversions v ON v.clickid = c.clickid GROUP BY c.offer, c.variant ORDER BY c.offer, c.variant";
    return (this.ledger.db.prepare(sql).all() as { offer: string; variant: number | null; clicks: number; conversions: number; payout: number }[]).map((r) => ({ ...r }));
  }

  clickOffer(clickid: string): string | null {
    const row = this.ledger.db.prepare("SELECT offer FROM clicks WHERE clickid = ?").get(clickid) as { offer: string } | undefined;
    return row?.offer ?? null;
  }
}

/** Constant-time token check: a postback URL carries a shared secret, and comparing it with === leaks its length and prefix through timing. */
export function tokenOk(given: string | null | undefined, expected: string): boolean {
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
