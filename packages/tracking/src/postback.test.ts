import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { Ledger, PostbackStore, createReceiver, pickVariant, expandMacros, macrosIn, tokenOk, MACROS, STATUSES, type PostbackInput } from "./index.ts";

const TOKEN = "postback-token-not-a-secret";
const OFFERS = { casino1: "https://network.example/o/42?cid={clickid}&s1={sub1}&s2={sub2}" };

async function boot() {
  const ledger = new Ledger();
  const store = new PostbackStore(ledger);
  const server = createReceiver({ ledger, signingKey: "k", ownerEmail: "o@example.com", postback: { store, token: TOKEN, offers: OFFERS } });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { ledger, store, base, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}

test("macros: every known macro is filled and URL-encoded, a missing value is empty, case does not matter", () => {
  const values = { clickid: "a b", sub1: "x&y", sub2: "é", sub3: "3", payout: 1.5, currency: "USD", status: "sale", txid: "t/1" };
  for (const m of MACROS) {
    const out = expandMacros(`https://x.example/?v={${m}}`, values);
    assert.equal(out, `https://x.example/?v=${encodeURIComponent(String(values[m]))}`);
    assert.equal(expandMacros(`?v={${m.toUpperCase()}}`, values), `?v=${encodeURIComponent(String(values[m]))}`);
    assert.equal(expandMacros(`?v={${m}}`, {}), "?v=");
  }
});

test("macros: an unknown macro throws instead of being left in the URL, and a stray brace is not a macro", () => {
  for (const bad of ["{click_id}", "{cid}", "{Payout2}", "{}"]) {
    if (bad === "{}") { assert.equal(expandMacros(bad, {}), "{}"); continue; }
    assert.throws(() => expandMacros(`?v=${bad}`, {}), /unknown macro/);
  }
  assert.equal(expandMacros("a{b c}d", {}), "a{b c}d");
  assert.deepEqual(macrosIn("?a={clickid}&b={SUB1}&c={clickid}"), ["clickid", "sub1"]);
});

test("token check: equal passes; different, shorter, longer, empty or missing fail", () => {
  assert.equal(tokenOk(TOKEN, TOKEN), true);
  for (const g of [TOKEN + "x", TOKEN.slice(1), "", null, undefined, "x".repeat(TOKEN.length)]) assert.equal(tokenOk(g as string, TOKEN), false);
  assert.equal(tokenOk("anything", ""), false);
});

/** Seeded generator: a world of clicks and a long, messy stream of postbacks with duplicates, bad inputs, other statuses and unknown clicks. */
function mulberry(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** The rules, as one function over any store: stored rows = distinct valid (click, status, txid); nothing invalid is stored; report totals equal the stored rows. */
function runWorld(make: (l: Ledger) => PostbackStore, seed: number): string[] {
  const rnd = mulberry(seed);
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
  const ledger = new Ledger();
  const store = make(ledger);
  const clicks = Array.from({ length: 1 + Math.floor(rnd() * 6) }, (_, i) => store.newClick({ offer: "casino1", sub1: pick(["a", "b", "c"]), sub2: `s${i}` }));
  const expected = new Map<string, number>();
  const problems: string[] = [];
  for (let step = 0; step < 120; step++) {
    const roll = rnd();
    const p: PostbackInput = {
      clickid: roll < 0.08 ? "not-a-uuid" : roll < 0.14 ? "00000000-0000-4000-8000-000000000000" : pick(clicks),
      status: roll > 0.9 ? "bogus" : pick([...STATUSES, "SALE", " lead "]),
      payout: roll > 0.8 && roll <= 0.86 ? "-3" : roll > 0.86 && roll <= 0.9 ? "1e9" : pick(["0", "1.5", "20", "7.1234"]),
      currency: roll > 0.95 ? "DOLLARS" : pick(["USD", "eur", ""]),
      txid: rnd() < 0.5 ? undefined : pick(["t1", "t2", "t3"]),
    };
    const r = store.record(p);
    const valid = /^[0-9a-f-]{36}$/.test(p.clickid ?? "") && clicks.includes(p.clickid as string)
      && (STATUSES as readonly string[]).includes(String(p.status).trim().toLowerCase())
      && /^\d{1,9}(\.\d{1,4})?$/.test(String(p.payout)) && /^[A-Za-z]{3}$|^$/.test(String(p.currency));
    // lifecycle model: a reject is final for its click, and a hold cannot follow a sale
    const st = String(p.status).trim().toLowerCase();
    const have = new Set([...expected.keys()].filter((k) => k.startsWith(`${p.clickid}|`)).map((k) => k.split("|")[1]));
    const blocked = valid && ((have.has("reject") && st !== "reject") || (have.has("sale") && st === "hold"));
    const wantOk = valid && !blocked;
    if (r.ok !== wantOk) problems.push(`step ${step}: ok=${r.ok} but expected ${wantOk} for ${JSON.stringify(p)} with ${[...have]}`);
    if (r.ok && wantOk) {
      const key = `${p.clickid}|${st}|${p.txid ?? ""}`;
      const first = !expected.has(key);
      if (first) expected.set(key, 1);
      if (r.inserted !== first) problems.push(`step ${step}: inserted=${r.inserted} but first=${first}`);
    }
  }
  const stored = (ledger.db.prepare("SELECT COUNT(*) AS n FROM conversions").get() as { n: number }).n;
  if (stored !== expected.size) problems.push(`stored ${stored} rows but ${expected.size} distinct valid postbacks`);
  const reported = store.report().reduce((n, r) => n + r.conversions, 0);
  if (reported !== stored) problems.push(`report says ${reported} but ${stored} are stored`);
  return problems;
}

test("property: over 200 seeded worlds a duplicate is never counted twice, an invalid postback is never stored, the report matches the rows", () => {
  const bad: string[] = [];
  for (let seed = 1; seed <= 200; seed++) for (const p of runWorld((l) => new PostbackStore(l), seed)) bad.push(`seed ${seed}: ${p}`);
  assert.deepEqual(bad.slice(0, 5), []);
});

test("mutation control: a store that counts a repeated postback again is caught by the same world", () => {
  class CountsTwice extends PostbackStore {
    constructor(l: Ledger) { super(l); }
    record(p: PostbackInput, now = new Date()) {
      const r = super.record({ ...p, txid: `${p.txid ?? ""}#${Math.random()}` }, now); // every call looks like a new transaction
      return r;
    }
  }
  const caught = Array.from({ length: 20 }, (_, i) => runWorld((l) => new CountsTwice(l), i + 1)).filter((p) => p.length > 0).length;
  assert.ok(caught >= 15, `the mutant slipped through ${20 - caught} of 20 worlds`);
});

test("reconcile: a postback the network lists but we never received is named, and one we hold that it lacks is counted", () => {
  const ledger = new Ledger();
  const store = new PostbackStore(ledger);
  const a = store.newClick({ offer: "casino1", sub1: "a" });
  const b = store.newClick({ offer: "casino1", sub1: "b" });
  assert.equal(store.record({ clickid: a, status: "sale", payout: "10", txid: "t1" }).ok, true);
  const r = store.reconcile([{ clickid: a, status: "SALE", txid: "t1" }, { clickid: b, status: "sale", txid: "t9" }]);
  assert.deepEqual(r, { missingAtNetwork: 0, missingHere: [{ clickid: b, status: "sale", txid: "t9" }] });
  assert.equal(store.reconcile([]).missingAtNetwork, 1);
});

test("http: /click issues an id, redirects to the offer with macros filled, and the id comes back through /postback exactly once", async () => {
  const { base, store, ledger, close } = await boot();
  try {
    const click = await fetch(`${base}/click?offer=casino1&sub1=fb&sub2=ad7`, { redirect: "manual" });
    assert.equal(click.status, 302);
    const loc = new URL(click.headers.get("location")!);
    const clickid = loc.searchParams.get("cid")!;
    assert.match(clickid, /^[0-9a-f-]{36}$/);
    assert.equal(loc.searchParams.get("s1"), "fb");
    assert.equal(loc.searchParams.get("s2"), "ad7");
    const pb = (extra: string) => fetch(`${base}/postback?token=${TOKEN}&clickid=${clickid}&${extra}`);
    const first = await pb("status=sale&payout=12.5&currency=usd&txid=T1");
    assert.deepEqual(await first.json(), { ok: true, inserted: true });
    const again = await pb("status=sale&payout=12.5&currency=usd&txid=T1");
    assert.deepEqual(await again.json(), { ok: true, inserted: false });
    assert.equal((ledger.db.prepare("SELECT COUNT(*) AS n FROM conversions").get() as { n: number }).n, 1);
    assert.deepEqual(store.report(), [{ sub1: "fb", status: "sale", conversions: 1, payout: 12.5 }]);
  } finally { await close(); }
});

test("http: a wrong or missing token is 401, an unknown click 404, bad input 400, an unknown offer 404, and nothing is stored for any of them", async () => {
  const { base, ledger, store, close } = await boot();
  try {
    const clickid = store.newClick({ offer: "casino1" });
    const get = async (path: string) => (await fetch(`${base}${path}`, { redirect: "manual" })).status;
    assert.equal(await get(`/postback?clickid=${clickid}&status=sale`), 401);
    assert.equal(await get(`/postback?token=nope&clickid=${clickid}&status=sale`), 401);
    assert.equal(await get(`/postback?token=${TOKEN}&clickid=00000000-0000-4000-8000-000000000000&status=sale`), 404);
    assert.equal(await get(`/postback?token=${TOKEN}&clickid=${clickid}&status=refund`), 400);
    assert.equal(await get(`/postback?token=${TOKEN}&clickid=${clickid}&status=sale&payout=abc`), 400);
    assert.equal(await get(`/postback?token=${TOKEN}&clickid=junk&status=sale`), 400);
    assert.equal(await get(`/click?offer=nothing`), 404);
    assert.equal((ledger.db.prepare("SELECT COUNT(*) AS n FROM conversions").get() as { n: number }).n, 0);
  } finally { await close(); }
});

test("lifecycle and window: a reject is final, a hold cannot follow a sale, a sale can be reversed, a late conversion is refused, an old click inside the window is kept", () => {
  const store = new PostbackStore(new Ledger(), 30);
  const t0 = new Date("2026-11-03T00:00:00Z");
  const day = 86_400_000;
  const a = store.newClick({ offer: "o" }, t0);
  assert.equal(store.record({ clickid: a, status: "reject", txid: "r1" }, t0).ok, true);
  assert.deepEqual(store.record({ clickid: a, status: "sale", txid: "s1" }, t0), { ok: false, error: "reject_is_final" });
  assert.equal(store.record({ clickid: a, status: "reject", txid: "r2" }, t0).ok, true);
  const b = store.newClick({ offer: "o" }, t0);
  assert.equal(store.record({ clickid: b, status: "sale", payout: "5", txid: "s1" }, t0).ok, true);
  assert.deepEqual(store.record({ clickid: b, status: "hold", txid: "h1" }, t0), { ok: false, error: "hold_after_sale" });
  assert.equal(store.record({ clickid: b, status: "reject", txid: "chargeback" }, t0).ok, true, "a sale reversed to reject is allowed");
  const c = store.newClick({ offer: "o" }, t0);
  assert.equal(store.record({ clickid: c, status: "lead", txid: "in" }, new Date(t0.getTime() + 29 * day)).ok, true);
  assert.deepEqual(store.record({ clickid: c, status: "sale", txid: "late" }, new Date(t0.getTime() + 31 * day)), { ok: false, error: "outside_window" });
  assert.throws(() => new PostbackStore(new Ledger(), 0), /positive/);
});

test("mutation control: a lifecycle check whose query finds no earlier statuses (the defect this code first shipped with) is caught by the same worlds", () => {
  const blind = (l: Ledger) => {
    const real = l.db.prepare.bind(l.db);
    (l.db as unknown as { prepare: (s: string) => unknown }).prepare = (sql: string) => (/SELECT DISTINCT status/.test(sql) ? { all: () => [] } : real(sql));
    return new PostbackStore(l);
  };
  const caught = Array.from({ length: 20 }, (_, i) => runWorld(blind, i + 1)).filter((x) => x.length > 0).length;
  assert.ok(caught >= 15, `the lifecycle mutant slipped through ${20 - caught} of 20 worlds`);
});

test("rotation: weights are respected over many draws, a bad weight or an empty list throws, and a click remembers its variant", async () => {
  const variants = [{ url: "https://a.example/{clickid}", weight: 3 }, { url: "https://b.example/{clickid}", weight: 1 }];
  const rnd = mulberry(7);
  const counts = [0, 0];
  for (let i = 0; i < 4000; i++) counts[pickVariant(variants, rnd)]++;
  assert.ok(counts[0] > 2800 && counts[0] < 3200, `variant 0 got ${counts[0]} of 4000 with weight 3 of 4`);
  for (const bad of [[], [{ url: "x", weight: 0 }], [{ url: "x", weight: -1 }], [{ url: "x", weight: NaN }]]) assert.throws(() => pickVariant(bad as never), /weight|at least one/);
  assert.equal(pickVariant([{ url: "x", weight: 5 }], () => 0.999999), 0);
  const ledger = new Ledger();
  const store = new PostbackStore(ledger);
  const server = createReceiver({ ledger, signingKey: "k", ownerEmail: "o@example.com", postback: { store, token: TOKEN, offers: { rot: variants }, random: () => 0.9 } });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const res = await fetch(`${base}/click?offer=rot&sub1=x`, { redirect: "manual" });
    const loc = res.headers.get("location")!;
    assert.ok(loc.startsWith("https://b.example/"), "0.9 of the total weight lands on the second link");
    const clickid = loc.split("/").pop()!;
    await fetch(`${base}/postback?token=${TOKEN}&clickid=${clickid}&status=sale&payout=4`);
    const rep = await (await fetch(`${base}/report?token=${TOKEN}`)).json() as { byVariant: unknown[] };
    assert.deepEqual(rep.byVariant, [{ offer: "rot", variant: 1, clicks: 1, conversions: 1, payout: 4 }]);
    assert.equal((await fetch(`${base}/report`)).status, 401);
  } finally { server.closeAllConnections(); server.close(); }
});

test("http: the routes do not exist unless postback is configured", async () => {
  const ledger = new Ledger();
  const server = createReceiver({ ledger, signingKey: "k", ownerEmail: "o@example.com" });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.equal((await fetch(`${base}/postback?token=x`)).status, 404);
    assert.equal((await fetch(`${base}/click?offer=a`, { redirect: "manual" })).status, 404);
  } finally { server.closeAllConnections(); server.close(); }
});
