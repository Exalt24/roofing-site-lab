// The first-party lead ledger: SQLite via node:sqlite. Every call and form is written here BEFORE anything else happens to it.
import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import type { LeadEvent } from "./callrail.ts";

export type Stage = "new" | "estimate" | "sold" | "lost";

export interface LeadRow {
  id: number; kind: string; source_event_id: string; occurred_at: string; received_at: string; phone_e164: string | null; email_sha256: string | null;
  landing_page_url: string | null; source: string | null; medium: string | null; campaign: string | null; utm_source: string | null; utm_medium: string | null; utm_campaign: string | null;
  gclid: string | null; wbraid: string | null; gbraid: string | null; msclkid: string | null; ga_client_id: string | null; first_time: number | null;
  stage: Stage; estimate_value: number | null; sold_value: number | null; sold_at: string | null;
  click_at: string | null; tracking_number: string | null; consent_version: string | null; marketing_opt_in: number; measurement_opt_in: number | null; // measurement_opt_in is the form's separate unticked ad-measurement box (null for a call, which the caller greeting covers). The wording of the purpose notice the person saw, and whether they ticked the separate, unticked-by-default marketing box (BC PIPA, CASL)
}

export const sha256 = (s: string) => createHash("sha256").update(s.trim().toLowerCase()).digest("hex");

/** Google's normalisation before hashing an email (developers.google.com/data-manager/api/devguides/concepts/formatting): all whitespace removed, lower case, and for gmail.com and googlemail.com
 *  the dots before the @ are removed and so is a plus sign and everything after it in the local part. The ledger and the Ads builder share this so the two hashes match. */
export function normaliseEmail(email: string): string {
  const e = email.split(/\s+/).join("").toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 0) return e;
  let local = e.slice(0, at);
  const domain = e.slice(at + 1);
  if (domain === "gmail.com" || domain === "googlemail.com") local = local.split("+")[0].split(".").join("");
  return `${local}@${domain}`;
}

export class Ledger {
  db: DatabaseSync;
  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA secure_delete = ON;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS leads (
        id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL CHECK (kind IN ('call','form')), source_event_id TEXT NOT NULL,
        occurred_at TEXT NOT NULL, received_at TEXT NOT NULL, phone_e164 TEXT, email_sha256 TEXT, landing_page_url TEXT,
        source TEXT, medium TEXT, campaign TEXT, utm_source TEXT, utm_medium TEXT, utm_campaign TEXT,
        gclid TEXT, wbraid TEXT, gbraid TEXT, msclkid TEXT, ga_client_id TEXT, first_time INTEGER,
        stage TEXT NOT NULL DEFAULT 'new' CHECK (stage IN ('new','estimate','sold','lost')), estimate_value REAL, sold_value REAL, sold_at TEXT,
        consent_version TEXT, marketing_opt_in INTEGER NOT NULL DEFAULT 0 CHECK (marketing_opt_in IN (0,1)), click_at TEXT, tracking_number TEXT, measurement_opt_in INTEGER CHECK (measurement_opt_in IN (0,1)),
        raw_json TEXT NOT NULL, UNIQUE (kind, source_event_id)
      );
      CREATE TABLE IF NOT EXISTS outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER NOT NULL REFERENCES leads(id), channel TEXT NOT NULL, payload TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL, sent_at TEXT, last_error TEXT, claimed_at TEXT
      );
    `);
    // a database made before click_at existed gets the column added
    const cols = this.db.prepare("PRAGMA table_info(leads)").all() as { name: string }[];
    if (!cols.some((c) => c.name === "click_at")) this.db.exec("ALTER TABLE leads ADD COLUMN click_at TEXT");
    if (!cols.some((c) => c.name === "tracking_number")) this.db.exec("ALTER TABLE leads ADD COLUMN tracking_number TEXT");
    if (!cols.some((c) => c.name === "measurement_opt_in")) this.db.exec("ALTER TABLE leads ADD COLUMN measurement_opt_in INTEGER CHECK (measurement_opt_in IN (0,1))");
  }

  /** Idempotent: a re-delivered or reconciled event never creates a second row. */
  insert(e: LeadEvent, now = new Date()): { inserted: boolean; id: number } {
    // The same call can arrive under two ids: CallRail documents that its API accepts the old numeric webhook id and lists the call as "CAL..." (and that webhooks now carry that as resource_id), but a
    // payload that carries only the numeric id still exists. So, as a fallback after the exact id, a call from the same caller number (and the same tracking number when both are known) that started
    // within one second of a stored call is treated as the same call.
    if (e.kind === "call" && e.phoneE164) {
      const sec = Math.floor(Date.parse(e.occurredAt) / 1000);
      if (Number.isFinite(sec)) {
        const twin = this.db.prepare("SELECT id FROM leads WHERE kind = 'call' AND phone_e164 = ? AND ABS(CAST(strftime('%s', occurred_at) AS INTEGER) - ?) <= 1 AND (tracking_number IS NULL OR ? IS NULL OR tracking_number = ?)").get(e.phoneE164, sec, e.trackingNumber ?? null, e.trackingNumber ?? null) as { id: number } | undefined;
        if (twin) return { inserted: false, id: twin.id };
      }
    }
    // ON CONFLICT, not check-then-insert: a webhook and the nightly reconcile can race for the same call, and the loser must read "already stored", not throw.
    const r = this.db.prepare(`INSERT INTO leads (kind, source_event_id, occurred_at, received_at, phone_e164, email_sha256, landing_page_url, source, medium, campaign, utm_source, utm_medium, utm_campaign, gclid, wbraid, gbraid, msclkid, ga_client_id, first_time, consent_version, marketing_opt_in, raw_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT (kind, source_event_id) DO NOTHING`).run(
      e.kind, e.sourceEventId, e.occurredAt, now.toISOString(), e.phoneE164, e.email ? sha256(normaliseEmail(e.email)) : null, e.landingPageUrl, e.source, e.medium, e.campaign,
      e.utm.source ?? null, e.utm.medium ?? null, e.utm.campaign ?? null, e.gclid ?? null, e.wbraid ?? null, e.gbraid ?? null, e.msclkid ?? null, e.gaClientId ?? null,
      e.firstTime === null ? null : e.firstTime ? 1 : 0, e.consentVersion ?? null, e.marketingOptIn ? 1 : 0, JSON.stringify(redact(e.raw)));
    if (Number(r.changes) === 0) {
      const existing = this.db.prepare("SELECT id FROM leads WHERE kind = ? AND source_event_id = ?").get(e.kind, e.sourceEventId) as { id: number };
      return { inserted: false, id: existing.id };
    }
    const id = Number(r.lastInsertRowid);
    if (e.clickAt) this.db.prepare("UPDATE leads SET click_at = ? WHERE id = ?").run(e.clickAt, id);
    if (e.trackingNumber) this.db.prepare("UPDATE leads SET tracking_number = ? WHERE id = ?").run(e.trackingNumber, id);
    if (e.measurementOptIn !== undefined) this.db.prepare("UPDATE leads SET measurement_opt_in = ? WHERE id = ?").run(e.measurementOptIn ? 1 : 0, id);
    return { inserted: true, id };
  }

  get(id: number): LeadRow | undefined { return this.db.prepare("SELECT * FROM leads WHERE id = ?").get(id) as LeadRow | undefined; }
  all(): LeadRow[] { return this.db.prepare("SELECT * FROM leads ORDER BY id").all() as unknown as LeadRow[]; }
  count(kind?: string): number { return (this.db.prepare(kind ? "SELECT COUNT(*) c FROM leads WHERE kind = ?" : "SELECT COUNT(*) c FROM leads").get(...(kind ? [kind] : [])) as { c: number }).c; }

  findByPhone(e164: string): LeadRow[] { return this.db.prepare("SELECT * FROM leads WHERE phone_e164 = ? ORDER BY occurred_at").all(e164) as unknown as LeadRow[]; }

  /** estimate and sold-job values come back from the estimating software; the join key is the E.164 phone number. */
  setStage(id: number, stage: Stage, opts: { value?: number; at?: string } = {}) {
    const row = this.get(id);
    if (!row) throw new Error(`no lead ${id}`);
    const order: Stage[] = ["new", "estimate", "sold"];
    if (stage !== "lost" && row.stage !== "lost" && order.indexOf(stage) < order.indexOf(row.stage)) throw new Error(`a lead cannot go back from ${row.stage} to ${stage}`);
    if (row.stage === "sold" || (row.stage === "lost" && stage !== "lost")) throw new Error(`a ${row.stage} lead cannot change to ${stage}`);
    if (opts.value !== undefined && (!Number.isFinite(opts.value) || opts.value < 0)) throw new Error("a value must be a number of zero or more");
    if (opts.at !== undefined && Number.isNaN(new Date(opts.at).getTime())) throw new Error("the date is not a valid date");
    if (stage === "estimate") this.db.prepare("UPDATE leads SET stage='estimate', estimate_value=? WHERE id=?").run(opts.value ?? null, id);
    else if (stage === "sold") this.db.prepare("UPDATE leads SET stage='sold', sold_value=?, sold_at=? WHERE id=?").run(opts.value ?? null, opts.at ?? new Date().toISOString(), id);
    else this.db.prepare("UPDATE leads SET stage=? WHERE id=?").run(stage, id);
  }

  // ---- outbox: the message exists durably before any email is attempted ----
  enqueue(leadId: number, channel: string, payload: unknown, now = new Date()): number {
    const r = this.db.prepare("INSERT INTO outbox (lead_id, channel, payload, next_attempt_at) VALUES (?,?,?,?)").run(leadId, channel, JSON.stringify(payload), now.toISOString());
    return Number(r.lastInsertRowid);
  }
  /** A message that has failed 12 times (about 16 hours of backoff in total) stops being retried and stays in the table for a person to look at. */
  due(now = new Date()) { return this.db.prepare("SELECT * FROM outbox WHERE sent_at IS NULL AND attempts < 12 AND next_attempt_at <= ? ORDER BY id").all(now.toISOString()) as unknown as { id: number; lead_id: number; channel: string; payload: string; attempts: number }[]; }
  /** Two overlapping drains must not both send the same row: the first to claim it wins, and a claim older than 10 minutes counts as abandoned. */
  claim(id: number, now = new Date()): boolean {
    const stale = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
    return Number(this.db.prepare("UPDATE outbox SET claimed_at=? WHERE id=? AND sent_at IS NULL AND (claimed_at IS NULL OR claimed_at < ?)").run(now.toISOString(), id, stale).changes) === 1;
  }
  /** Once sent, the message body (a name, a phone number, what the person wrote) is blanked: the ledger keeps the lead, the outbox does not keep a second copy. */
  markSent(id: number, now = new Date()) {
    this.db.prepare("UPDATE outbox SET sent_at=?, last_error=NULL, payload='{}', claimed_at=NULL WHERE id=?").run(now.toISOString(), id);
    this.scrub(); // the blanked message text must not linger in the write-ahead log either
  }

  /** Empties the write-ahead log and the free list so deleted or blanked text is not left in the file. Returns false when another connection is reading and the log could not be emptied yet. */
  scrub(): boolean {
    const r = this.db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get() as { busy?: number } | undefined;
    return !r || r.busy === 0;
  }
  markFailed(id: number, error: string, now = new Date()) {
    const row = this.db.prepare("SELECT attempts FROM outbox WHERE id=?").get(id) as { attempts: number } | undefined;
    if (!row) return;
    const wait = Math.min(2 ** row.attempts * 60, 4 * 3600); // 1, 2, 4, ... minutes, capped at 4 hours (so 11 failures wait about 16 hours in total)
    this.db.prepare("UPDATE outbox SET attempts=attempts+1, last_error=?, next_attempt_at=?, claimed_at=NULL WHERE id=?").run(error.slice(0, 300), new Date(now.getTime() + wait * 1000).toISOString(), id);
  }
  pending(): number { return (this.db.prepare("SELECT COUNT(*) c FROM outbox WHERE sent_at IS NULL").get() as { c: number }).c; }
  newSubmissionId(): string { return randomUUID(); }

  /** The privacy page promises quote requests and call records are deleted after a fixed number of months. This is the job that does it: leads older than the cutoff go, with their outbox rows. Run it daily. */
  purgeOlderThan(months: number, now = new Date()): { leads: number; outbox: number; scrubbed: boolean } {
    if (!Number.isInteger(months) || months < 1) throw new Error("months must be a whole number, 1 or more");
    const cutoff = new Date(now); cutoff.setMonth(cutoff.getMonth() - months);
    const iso = cutoff.toISOString();
    const outbox = Number(this.db.prepare("DELETE FROM outbox WHERE lead_id IN (SELECT id FROM leads WHERE received_at < ?)").run(iso).changes);
    const leads = Number(this.db.prepare("DELETE FROM leads WHERE received_at < ?").run(iso).changes);
    // "deleted" has to mean gone from the file: secure_delete zeroes freed pages and the checkpoint plus VACUUM drops them from the write-ahead log and the free list
    let scrubbed = true;
    if (leads || outbox) { this.db.exec("VACUUM"); scrubbed = this.scrub(); }
    return { leads, outbox, scrubbed };
  }
}

// The raw payload is kept for audit, but ONLY the fields on this allow-list. Everything else in a CallRail payload (formatted numbers and names, notes, transcriptions, voicemail,
// recording links, every form field) is dropped: an allow-list stays safe when CallRail adds a field, a deny-list leaks it.
const KEEP = new Set(["id", "resource_id", "start_time", "submitted_at", "timestamp", "duration", "direction", "answered", "first_call", "first_form", "source", "medium", "campaign", "keywords", "landing_page_url", "referrer", "referring_url",
  "utm_source", "utm_medium", "utm_campaign", "tracking_phone_number", "business_phone_number", "device_type", "form", "landing_page", "service", "area"]);
function redact(raw: unknown): unknown {
  const j = JSON.parse(JSON.stringify(raw ?? {})) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(j)) if (KEEP.has(k) && (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null)) out[k] = v;
  if (j.form_data && typeof j.form_data === "object") out.form_field_names = Object.keys(j.form_data as object);
  return out;
}
