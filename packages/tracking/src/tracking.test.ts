import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { sign, verifySignature, toE164, gaClientIdFrom, clickIds, parseCall, parseForm, Ledger, createReceiver, drainOutbox, sha256, ga4Payload, adsIngestEvent, adsIngestRequest, leadsNearingClickExpiry, reconcileCalls } from "./index.ts";

const KEY = "test-signing-key-not-a-secret";
const callBody = (id: number, extra: object = {}) => JSON.stringify({ id: `CAL${id}`, customer_phone_number: "+16045550100", customer_name: "Test Caller", tracking_phone_number: "+17785550101", start_time: new Date(Date.parse("2026-10-05T21:03:00Z") + (Number(String(id).replace(/[^0-9]/g, "")) % 5000 + [...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0)) * 60000).toISOString(), source: "Google Ads", landing_page_url: "https://seabreeze-roofing.example/projects/?gclid=Cj0abc&utm_source=google&utm_medium=cpc", first_call: true, ...extra });

async function boot(opts: Partial<Parameters<typeof createReceiver>[0]> = {}) {
  const ledger = new Ledger();
  const server = createReceiver({ ledger, signingKey: KEY, ownerEmail: "owner@example.com", ...opts });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { ledger, server, base, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}

test("HMAC-SHA1 matches the published RFC 2202 test vector, so the signing primitive is the right one", () => {
  const got = sign("what do ya want for nothing?", "Jefe");
  assert.equal(Buffer.from(got, "base64").toString("hex"), "effcdf6ae5eb2fa2d27416d5f184df9c259a7c79");
});

test("a valid signature passes, a tampered body or a wrong key fails", () => {
  const body = callBody(1);
  const sig = sign(body, KEY);
  assert.equal(verifySignature(body, sig, KEY), true);
  assert.equal(verifySignature(body + " ", sig, KEY), false);
  assert.equal(verifySignature(body, sig, "another-key"), false);
  assert.equal(verifySignature(body, null, KEY), false);
  assert.equal(verifySignature(body, "short", KEY), false);
});

test("phone numbers are normalised to E.164 and junk is refused", () => {
  assert.equal(toE164("(604) 555-0142"), "+16045550142");
  assert.equal(toE164("1-604-555-0142"), "+16045550142");
  assert.equal(toE164("+44 20 7946 0958"), "+442079460958");
  assert.equal(toE164("12345"), null);
  assert.equal(toE164(""), null);
});

test("the form webhook has no gclid key, so the click id is parsed from the landing page url", () => {
  const ev = parseForm({ id: 77, form_data: { name: "Ana", phone: "604-555-0188", email: "ana@example.com" }, landing_page_url: "https://x.example/p/?gclid=ZZ9&wbraid=W1&utm_campaign=roof", submitted_at: "2026-10-05T10:00:00Z", first_form: true });
  assert.equal(ev.gclid, "ZZ9"); assert.equal(ev.wbraid, "W1"); assert.equal(ev.utm.campaign, "roof"); assert.equal(ev.phoneE164, "+16045550188");
  assert.deepEqual(clickIds("not a url at all"), {});
});

test("a signed call webhook is stored before it is acknowledged, and a redelivery creates no second row", async () => {
  const t = await boot();
  const body = callBody(5);
  const post = () => fetch(t.base + "/callrail/post-call", { method: "POST", headers: { Signature: sign(body, KEY), "Content-Type": "application/json" }, body });
  const a = await (await post()).json() as { inserted: boolean };
  const b = await (await post()).json() as { inserted: boolean };
  assert.equal(a.inserted, true); assert.equal(b.inserted, false);
  assert.equal(t.ledger.count("call"), 1);
  const row = t.ledger.all()[0];
  assert.equal(row.gclid, "Cj0abc"); assert.equal(row.phone_e164, "+16045550100"); assert.equal(row.utm_source, "google");
  assert.doesNotMatch(JSON.stringify(row), /Test Caller/, "the caller's name is not kept in clear text");
  await t.close();
});

test("MUTANT: a forged webhook is refused and nothing is written", async () => {
  const t = await boot();
  const body = callBody(6);
  const r = await fetch(t.base + "/callrail/post-call", { method: "POST", headers: { Signature: sign(body, "wrong"), "Content-Type": "application/json" }, body });
  assert.equal(r.status, 401);
  assert.equal(t.ledger.count(), 0);
  await t.close();
});

test("a stale webhook outside the replay window is refused when a window is configured", async () => {
  const t = await boot({ replayWindowSeconds: 300, now: () => new Date("2026-10-05T14:30:00-07:00") });
  const body = callBody(7, { timestamp: "2026-10-05T14:03:00-07:00" });
  const r = await fetch(t.base + "/callrail/post-call", { method: "POST", headers: { Signature: sign(body, KEY) }, body });
  assert.equal(r.status, 409);
  assert.equal(t.ledger.count(), 0);
  await t.close();
});

test("an oversized body is refused", async () => {
  const t = await boot({ maxBodyBytes: 1000 });
  const body = JSON.stringify({ id: "x", pad: "a".repeat(5000) });
  const r = await fetch(t.base + "/callrail/post-call", { method: "POST", headers: { Signature: sign(body, KEY) }, body });
  assert.equal(r.status, 413);
  await t.close();
});

const formData = (over: Record<string, string> = {}) => { const f = new FormData(); const d = { name: "Ana Souza", phone: "604-555-0188", email: "ana@example.com", message: "Water stain under the skylight", website: "", landing_page: "https://seabreeze-roofing.example/contact/?gclid=GG1&utm_source=google", ga_client_id: "123456.7890", measurement_opt_in: "yes", ...over }; for (const [k, v] of Object.entries(d)) f.set(k, v); return f; };

test("a quote form is stored with its click ids first, and the email waits in a durable outbox", async () => {
  const t = await boot();
  const r = await fetch(t.base + "/api/lead", { method: "POST", body: formData() });
  assert.equal(r.status, 200);
  const row = t.ledger.all()[0];
  assert.equal(row.gclid, "GG1"); assert.equal(row.ga_client_id, "123456.7890"); assert.equal(row.phone_e164, "+16045550188");
  assert.equal(row.email_sha256?.length, 64);
  assert.equal(t.ledger.pending(), 1);
  await t.close();
});

test("MUTANT: without the separate measurement box a form is stored with what the person typed and nothing else, and no Google upload can be built from it", async () => {
  const t = await boot();
  const r = await fetch(t.base + "/api/lead", { method: "POST", body: formData({ measurement_opt_in: "", gclid: "SHOULD-NOT-STAY", click_time: new Date().toISOString(), utm_source: "google" }) });
  assert.equal(r.status, 200);
  const row = t.ledger.all()[0];
  assert.equal(row.measurement_opt_in, 0);
  for (const k of ["gclid", "wbraid", "gbraid", "ga_client_id", "landing_page_url", "utm_source", "utm_campaign", "click_at"] as const) assert.equal(row[k], null, k);
  assert.equal(row.phone_e164, "+16045550188");
  assert.equal(row.email_sha256, null, "without the box not even a scrambled email is kept");
  const out = JSON.parse((t.ledger.db.prepare("SELECT payload FROM outbox").get() as { payload: string }).payload);
  assert.equal(out.text.includes("Page:"), false);
  assert.equal(adsIngestEvent(row, { stage: "sold", value: 100 }).event, null);
  assert.equal(ga4Payload(row, "generate_lead").payload, null);
  assert.match(adsIngestEvent(row, { stage: "sold", value: 100 }).note, /did not tick the measurement box/);
  await t.close();
});

test("MUTANT: withdrawing the advertising box deletes the click details, visitor number and landing page (also from the stored raw copy) and stops any Google upload; a call or an unknown id is refused", async () => {
  const t = await boot();
  await fetch(t.base + "/api/lead", { method: "POST", body: formData({ gclid: "GG-WITHDRAW", click_time: new Date().toISOString(), utm_source: "google" }) });
  const before = t.ledger.all()[0];
  assert.equal(before.gclid, "GG-WITHDRAW"); assert.equal(before.measurement_opt_in, 1); assert.equal(before.email_sha256?.length, 64);
  const t0 = new Date(Date.now() + 1000);
  const built = adsIngestEvent(before, { stage: "sold", value: 5, at: t0, uploadAt: new Date(t0.getTime() + 1000) });
  assert.ok(built.event?.userData?.userIdentifiers.some((u) => "emailAddress" in u && u.emailAddress === before.email_sha256), "the stored hash is what goes up");
  assert.equal(adsIngestEvent(before, { stage: "sold", value: 5, at: new Date(t0.getTime() + 5000), uploadAt: t0 }).event, null, "a conversion dated after the upload is refused"); assert.match(before.raw_json, /landing_page/);
  assert.equal(t.ledger.withdrawMeasurement(before.id), true);
  const after = t.ledger.get(before.id)!;
  for (const k of ["gclid", "wbraid", "gbraid", "ga_client_id", "landing_page_url", "utm_source", "utm_campaign", "click_at"] as const) assert.equal(after[k], null, k);
  assert.equal(after.measurement_opt_in, 0); assert.equal(after.email_sha256, null);
  assert.equal(/landing_page|GG-WITHDRAW/.test(after.raw_json), false, "the stored raw copy is cleaned too");
  assert.equal(after.phone_e164, before.phone_e164, "what they typed for the quote stays");
  assert.equal(adsIngestEvent(after, { stage: "sold", value: 1 }).event, null);
  const waiting = JSON.parse((t.ledger.db.prepare("SELECT payload FROM outbox WHERE lead_id = ? AND sent_at IS NULL").get(before.id) as { payload: string }).payload);
  assert.equal(/Page:/.test(waiting.text), false, "the unsent notification no longer names the landing page");
  assert.match(waiting.text, /Ana Souza/, "the rest of the notification is intact");
  const { id: cid } = t.ledger.insert({ ...parseForm({ id: 77, form_data: { name: "Bo", phone: "604-555-0166" }, landing_page_url: "https://x.example/?gclid=G77", source: "google", medium: "cpc", campaign: "CampX", keywords: "kw secret", submitted_at: "2026-10-05T10:00:00Z" }), measurementOptIn: true });
  assert.match(t.ledger.get(cid)!.raw_json, /CampX/);
  assert.equal(t.ledger.withdrawMeasurement(cid), true);
  assert.equal(/CampX|kw secret|google/.test(t.ledger.get(cid)!.raw_json), false, "campaign data in the raw copy of a CallRail form lead is gone too");
  assert.equal(t.ledger.withdrawMeasurement(99999), false);
  const { id: callId } = t.ledger.insert(parseCall({ id: "CALW1", customer_phone_number: "+16045550123", start_time: new Date().toISOString() }));
  assert.equal(t.ledger.withdrawMeasurement(callId), false);
  await t.close();
});

test("MUTANT: a purge whose scrub was blocked by a reader retries the scrub on the next purge, even when there is nothing new to delete", async () => {
  const { mkdtempSync, rmSync, readFileSync, existsSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { DatabaseSync } = await import("node:sqlite");
  const dir = mkdtempSync(join(tmpdir(), "sc-"));
  const file = join(dir, "l.sqlite");
  let reader: InstanceType<typeof DatabaseSync> | undefined;
  let l: Ledger | undefined;
  try {
    l = new Ledger(file);
    const old = new Date("2020-01-01T00:00:00Z");
    const { id } = l.insert(parseForm({ id: 41, form_data: { name: "Ana", phone: "604-555-0188" }, landing_page_url: "https://x.example/", submitted_at: "2020-01-01T00:00:00Z" }), old);
    l.enqueue(id, "email", { to: "o@x.example", subject: "s", text: "NEEDLE-SCRUB-RETRY" }, old);
    reader = new DatabaseSync(file);
    reader.exec("BEGIN");
    reader.prepare("SELECT COUNT(*) FROM leads").all();
    const now = new Date("2026-10-12T00:00:00Z");
    assert.equal(l.purgeOlderThan(24, now).scrubbed, false, "a reader blocks the checkpoint");
    reader.exec("COMMIT"); reader.close(); reader = undefined;
    assert.equal(l.purgeOlderThan(24, now).scrubbed, true, "the next purge retries the scrub although it deletes nothing");
    assert.equal(existsSync(file + "-wal") && readFileSync(file + "-wal").includes("NEEDLE-SCRUB-RETRY"), false);
  } finally { reader?.close(); l?.db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("MUTANT: the owner notification names the page without its query string, so no ad click id waits in the outbox; a click time that is not believable drops the click ids", async () => {
  const t = await boot();
  await fetch(t.base + "/api/lead", { method: "POST", body: formData({ submission_id: "a1" }) });
  const out = JSON.parse((t.ledger.db.prepare("SELECT payload FROM outbox ORDER BY id LIMIT 1").get() as { payload: string }).payload);
  assert.equal(/GG1|gclid/.test(out.text), false);
  assert.match(out.text, /Page: https:\/\/seabreeze-roofing\.example\/contact\/$/);
  await fetch(t.base + "/api/lead", { method: "POST", body: formData({ submission_id: "b2", phone: "604-555-0199", click_time: new Date(Date.now() + 5 * 86400000).toISOString() }) });
  const row = t.ledger.all().find((r) => r.phone_e164 === "+16045550199")!;
  assert.equal(row.gclid, null, "a click id with a future click time is dropped");
  assert.equal(row.measurement_opt_in, 1);
  await t.close();
});

test("MUTANT: reconcile does not store a call the business dialled as a lead, only inbound calls", async () => {
  const l = new Ledger();
  const rep = await reconcileCalls(l, async () => [
    { id: "CALOUT1", direction: "outbound", customer_phone_number: "+16045559999", start_time: "2026-10-05T10:00:00Z" },
    { id: "CALIN1", direction: "inbound", customer_phone_number: "+16045558888", start_time: "2026-10-05T11:00:00Z" },
    { id: "CALNODIR", customer_phone_number: "+16045557777", start_time: "2026-10-05T12:00:00Z" },
  ], "2026-10-01T00:00:00Z");
  assert.equal(rep.skippedOutbound, 1); assert.equal(rep.missing, 2); assert.equal(l.count("call"), 2);
});

test("MUTANT: a phone number that cannot exist is not stored or hashed, and a call's Google cookie loses its GA1.1 prefix", () => {
  for (const bad of ["+1604555014", "123-456-7890", "0045550142", "604-155-0142", "+1 (604) 055-0142"]) assert.equal(toE164(bad), null, bad);
  assert.equal(toE164("(604) 555-0188"), "+16045550188"); assert.equal(toE164("+44 20 7946 0958"), "+442079460958");
  assert.equal(gaClientIdFrom("GA1.1.123456789.1700000000"), "123456789.1700000000");
  assert.equal(gaClientIdFrom("123456789.1700000000"), "123456789.1700000000");
  assert.equal(parseCall({ id: "CALGA", customer_phone_number: "+16045550123", start_time: "2026-10-05T10:00:00Z", custom: { _ga: "GA1.1.55.66" } }).gaClientId, "55.66");
});

test("MUTANT: only the exact word yes counts as a tick, a message over 2000 characters is refused, a click older than 90 days drops the click ids, and the Ads request says HEX", async () => {
  const t = await boot();
  await fetch(t.base + "/api/lead", { method: "POST", body: formData({ submission_id: "h1", marketing_opt_in: "true", phone: "604-555-0101" }) });
  await fetch(t.base + "/api/lead", { method: "POST", body: formData({ submission_id: "h2", phone: "604-555-0102", click_time: new Date(Date.now() - 100 * 86400000).toISOString() }) });
  const by = (p: string) => t.ledger.all().find((r) => r.phone_e164 === p)!;
  assert.equal(by("+16045550101").marketing_opt_in, 0, "only yes counts");
  assert.equal(by("+16045550102").gclid, null, "a 100 day old click is dropped");
  assert.equal((await fetch(t.base + "/api/lead", { method: "POST", body: formData({ submission_id: "h3", phone: "604-555-0103", message: "x".repeat(2001) }) })).status, 400);
  const row = t.ledger.all()[0];
  assert.equal(adsIngestRequest({ operatingAccountId: "1", conversionActionId: "2" }, [], { consent: true }).encoding, "HEX");
  void row;
  await t.close();
});

test("MUTANT: a very long field cannot stall the receiver (no pattern backtracks on spaces or repeated characters)", async () => {
  const t = await boot();
  const big = " ".repeat(120_000);
  for (const field of ["phone", "name", "email", "message", "service", "area", "landing_page", "utm_source", "click_time", "submission_id"]) {
    const t0 = Date.now();
    const r = await fetch(t.base + "/api/lead", { method: "POST", body: formData({ [field]: field === "message" ? "a" + big : "6" + big + "b" }) });
    assert.ok(Date.now() - t0 < 1500, `${field} took ${Date.now() - t0} ms`);
    assert.ok(r.status === 400 || r.status === 200, `${field} gave ${r.status}`);
  }
  const t1 = Date.now(); assert.equal(toE164("6" + big + "b"), null); assert.ok(Date.now() - t1 < 100);
  await t.close();
});

test("MUTANT: a withdrawal blocked by a reader is retried by the next purge even though nothing is due, and a retried submission whose notification was never queued gets one", async () => {
  const { mkdtempSync, rmSync, readFileSync, existsSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { DatabaseSync } = await import("node:sqlite");
  const dir = mkdtempSync(join(tmpdir(), "wb-"));
  const file = join(dir, "l.sqlite");
  let reader: InstanceType<typeof DatabaseSync> | undefined;
  let l: Ledger | undefined;
  try {
    l = new Ledger(file);
    const { id } = l.insert({ ...parseForm({ id: 51, form_data: { name: "Ana", phone: "604-555-0188" }, landing_page_url: "https://x.example/?gclid=GCLIDWITHDRAWBLOCKED", submitted_at: new Date().toISOString() }), gaClientId: "9.9", measurementOptIn: true });
    reader = new DatabaseSync(file); reader.exec("BEGIN"); reader.prepare("SELECT COUNT(*) FROM leads").all();
    assert.equal(l.withdrawMeasurement(id), true);
    assert.equal(l.scrub(), false, "the reader still blocks the log");
    reader.exec("COMMIT"); reader.close(); reader = undefined;
    assert.equal(l.purgeOlderThan(24, new Date()).scrubbed, true);
    assert.equal(existsSync(file + "-wal") && readFileSync(file + "-wal").includes("GCLIDWITHDRAWBLOCKED"), false, "the click id is gone from the log after the daily purge");
  } finally { reader?.close(); l?.db.close(); rmSync(dir, { recursive: true, force: true }); }
  const t = await boot();
  const sid = "11111111-2222-4333-8444-555555555555";
  t.ledger.insert({ ...parseForm({ id: 52, form_data: { name: "Ana", phone: "604-555-0188" }, landing_page_url: "https://x.example/", submitted_at: new Date().toISOString() }), sourceEventId: `site-${sid}` });
  assert.equal(t.ledger.pending(), 0);
  await fetch(t.base + "/api/lead", { method: "POST", body: formData({ submission_id: sid }) });
  assert.equal(t.ledger.pending(), 1, "the stored lead whose notification was never queued is notified on the retry");
  await fetch(t.base + "/api/lead", { method: "POST", body: formData({ submission_id: sid }) });
  assert.equal(t.ledger.pending(), 1, "a second retry does not queue a second notification");
  await t.close();
});

test("MUTANT: every ad field is dropped without the box (wbraid, gbraid, campaign too), and a database made before the newer columns existed is upgraded when opened", async () => {
  const t = await boot();
  await fetch(t.base + "/api/lead", { method: "POST", body: formData({ submission_id: "pf1", measurement_opt_in: "no", wbraid: "WB", gbraid: "GB", utm_campaign: "CAMP", utm_medium: "cpc", click_time: new Date().toISOString() }) });
  const row = t.ledger.all()[0];
  for (const k of ["gclid", "wbraid", "gbraid", "ga_client_id", "landing_page_url", "utm_source", "utm_medium", "utm_campaign", "click_at", "source", "medium", "campaign"] as const) assert.equal(row[k], null, k);
  assert.equal(row.measurement_opt_in, 0);
  await t.close();

  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { DatabaseSync } = await import("node:sqlite");
  const dir = mkdtempSync(join(tmpdir(), "mg-"));
  const file = join(dir, "old.sqlite");
  try {
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE leads (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, source_event_id TEXT NOT NULL, occurred_at TEXT NOT NULL, received_at TEXT NOT NULL, phone_e164 TEXT, email_sha256 TEXT, landing_page_url TEXT,
      source TEXT, medium TEXT, campaign TEXT, utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, gclid TEXT, wbraid TEXT, gbraid TEXT, msclkid TEXT, ga_client_id TEXT, first_time INTEGER,
      stage TEXT NOT NULL DEFAULT 'new', estimate_value REAL, sold_value REAL, sold_at TEXT, consent_version TEXT, marketing_opt_in INTEGER NOT NULL DEFAULT 0, raw_json TEXT NOT NULL, UNIQUE (kind, source_event_id));
      CREATE TABLE outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER NOT NULL, channel TEXT NOT NULL, payload TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL, sent_at TEXT, last_error TEXT, claimed_at TEXT);
      INSERT INTO leads (kind, source_event_id, occurred_at, received_at, phone_e164, raw_json) VALUES ('form', 'old-1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '+16045550111', '{}');`);
    old.close();
    const l = new Ledger(file);
    const r = l.get(1)!;
    assert.ok("click_at" in r && "tracking_number" in r && "measurement_opt_in" in r, "the three newer columns exist");
    assert.equal(r.measurement_opt_in, null, "an old form lead has no recorded measurement consent, so no Google upload can be built from it");
    assert.equal(adsIngestEvent(r, { stage: "sold", value: 1 }).event, null);
    const a = parseCall({ id: "CAL2S1", customer_phone_number: "+16045550123", start_time: "2026-10-05T10:00:00Z" });
    const b = parseCall({ id: "999", customer_phone_number: "+16045550123", start_time: "2026-10-05T10:00:02Z" });
    assert.equal(l.insert(a).inserted, true); assert.equal(l.insert(b).inserted, true, "a call two seconds later is a new call, not a twin");
    l.db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("MUTANT: /health turns to 503 when a lead notification is stuck (no webhook, or out of retries) and says nothing else, and back to ok once it is sent", async () => {
  const t0 = new Date("2026-10-05T10:00:00Z");
  let clock = t0;
  const t = await boot({ now: () => clock });
  assert.equal((await fetch(t.base + "/health")).status, 200);
  const { id } = t.ledger.insert(parseForm({ id: 61, form_data: { name: "Ana", phone: "604-555-0188" }, landing_page_url: "https://x.example/", submitted_at: t0.toISOString() }), t0);
  t.ledger.enqueue(id, "email", { to: "o@x.example", subject: "s", text: "t" }, t0);
  clock = new Date(t0.getTime() + 30 * 60000);
  assert.equal((await fetch(t.base + "/health")).status, 200, "thirty minutes is still inside the grace");
  clock = new Date(t0.getTime() + 61 * 60000);
  const bad = await fetch(t.base + "/health");
  assert.equal(bad.status, 503); assert.deepEqual(await bad.json(), { ok: false });
  const row = t.ledger.due(new Date(clock.getTime() + 86400000))[0];
  t.ledger.markSent(row.id, clock);
  assert.equal((await fetch(t.base + "/health")).status, 200, "ok again once the notification went out");
  await t.close();
});

test("MUTANT: behind a plain proxy only the last X-Forwarded-For entry counts and a spoofed CF-Connecting-IP is ignored; behind Cloudflare the CF header is the address", async () => {
  const send = (t: Awaited<ReturnType<typeof boot>>, headers: Record<string, string>, i: number) => fetch(t.base + "/api/lead", { method: "POST", headers, body: formData({ phone: `604-555-03${10 + i}`, submission_id: `p${i}` }) }).then((r) => r.status);
  const plain = await boot({ rateLimit: { max: 2, windowSeconds: 60 }, trustProxyHeader: true });
  assert.deepEqual([await send(plain, { "x-forwarded-for": "9.9.9.9, 203.0.113.7", "cf-connecting-ip": "1.1.1.1" }, 1), await send(plain, { "x-forwarded-for": "8.8.8.8, 203.0.113.7", "cf-connecting-ip": "2.2.2.2" }, 2), await send(plain, { "x-forwarded-for": "7.7.7.7, 203.0.113.7", "cf-connecting-ip": "3.3.3.3" }, 3)], [200, 200, 429], "invented earlier entries and a spoofed CF header do not give a new budget");
  await plain.close();
  const cf = await boot({ rateLimit: { max: 2, windowSeconds: 60 }, trustCloudflare: true });
  assert.deepEqual([await send(cf, { "cf-connecting-ip": "1.1.1.1" }, 4), await send(cf, { "cf-connecting-ip": "2.2.2.2" }, 5), await send(cf, { "cf-connecting-ip": "3.3.3.3" }, 6)], [200, 200, 200], "behind Cloudflare each CF address has its own budget");
  await cf.close();
});

test("the forget and stage commands delete a person's lead, withdraw marketing consent and record how a lead turned out, in a real ledger file", async () => {
  const { execFileSync, spawnSync } = await import("node:child_process");
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "fg-"));
  const file = join(dir, "l.sqlite");
  const cli = (n: string) => new URL(`./${n}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  try {
    const l = new Ledger(file);
    const a = l.insert({ ...parseForm({ id: 71, form_data: { name: "Ana", phone: "604-555-0171" }, landing_page_url: "https://x.example/", submitted_at: new Date().toISOString() }), marketingOptIn: true }).id;
    const b = l.insert(parseForm({ id: 72, form_data: { name: "Bo", phone: "604-555-0172" }, landing_page_url: "https://x.example/", submitted_at: new Date().toISOString() })).id;
    l.enqueue(b, "email", { to: "o@x.example", subject: "s", text: "NEEDLE-FORGET" }, new Date());
    l.db.close();
    const run = (n: string, ...args: string[]) => execFileSync(process.execPath, ["--experimental-sqlite", cli(n), file, ...args], { encoding: "utf8" });
    assert.match(run("forget.ts", String(a), "--marketing-only"), /withdrawn/);
    assert.match(run("stage.ts", String(a), "estimate", "5200"), /stage estimate, estimate 5200/);
    assert.match(run("forget.ts", String(b)), /deleted/);
    assert.equal(spawnSync(process.execPath, ["--experimental-sqlite", cli("forget.ts"), file, "9999"]).status, 1);
    assert.equal(spawnSync(process.execPath, ["--experimental-sqlite", cli("stage.ts"), file, String(a), "bogus"]).status, 2);
    const after = new Ledger(file);
    assert.equal(after.get(a)!.marketing_opt_in, 0); assert.equal(after.get(a)!.stage, "estimate"); assert.equal(after.get(b), undefined);
    assert.equal(after.pending(), 0, "the deleted lead's waiting notification went with it");
    after.db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("MUTANT: a failure while queueing the notification stores nothing (the lead and its notification are one unit), the retry then stores both, and a retry that unticks the advertising box withdraws it", async () => {
  const t = await boot();
  const real = t.ledger.enqueue.bind(t.ledger);
  let boom = true;
  t.ledger.enqueue = ((...a: Parameters<typeof real>) => { if (boom) { boom = false; throw new Error("disk hiccup"); } return real(...a); }) as typeof real;
  const sid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  assert.equal((await fetch(t.base + "/api/lead", { method: "POST", body: formData({ submission_id: sid }) })).status, 500);
  assert.equal(t.ledger.count(), 0, "nothing half-stored");
  assert.equal((await fetch(t.base + "/api/lead", { method: "POST", body: formData({ submission_id: sid }) })).status, 200);
  assert.equal(t.ledger.count(), 1); assert.equal(t.ledger.pending(), 1);
  const stored = t.ledger.all()[0];
  assert.equal(stored.gclid, "GG1"); assert.equal(stored.measurement_opt_in, 1); assert.ok(stored.click_at === null || stored.click_at.length > 0);
  assert.equal((await fetch(t.base + "/api/lead", { method: "POST", body: formData({ submission_id: sid, measurement_opt_in: "" }) })).status, 200);
  const after = t.ledger.all()[0];
  assert.equal(after.gclid, null, "unticking on a retry withdraws the click id"); assert.equal(after.measurement_opt_in, 0);
  assert.equal(t.ledger.pending(), 1, "and no second notification");
  await t.close();
});

test("the withdraw command deletes one lead's advertising details in a real ledger file and refuses an unknown id", async () => {
  const { execFileSync, spawnSync } = await import("node:child_process");
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "wd-"));
  const file = join(dir, "ledger.sqlite");
  try {
    const l = new Ledger(file);
    const { id } = l.insert({ ...parseForm({ id: 31, form_data: { name: "Ana", phone: "604-555-0188" }, landing_page_url: "https://x.example/?gclid=G31", submitted_at: "2026-10-05T10:00:00Z" }), gaClientId: "1.2", measurementOptIn: true });
    l.db.close();
    const cli = new URL("./withdraw.ts", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
    const out = execFileSync(process.execPath, ["--experimental-sqlite", cli, file, String(id)], { encoding: "utf8" });
    assert.match(out, /withdrawn/);
    const reopened = new Ledger(file); const after = reopened.get(id)!; reopened.db.close();
    assert.equal(after.gclid, null); assert.equal(after.ga_client_id, null); assert.equal(after.measurement_opt_in, 0);
    assert.equal(spawnSync(process.execPath, ["--experimental-sqlite", cli, file, "9999"]).status, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("MUTANT: a form lead that arrives through CallRail's form webhook has no measurement box behind it, so neither Google builder will use it", () => {
  const l = new Ledger();
  const { id } = l.insert({ ...parseForm({ id: 21, form_data: { name: "Ana", phone: "604-555-0188", email: "ana@example.com" }, landing_page_url: "https://x.example/?gclid=G21", submitted_at: "2026-10-05T10:00:00Z" }), gaClientId: "111.222" });
  const row = l.get(id)!;
  assert.equal(row.measurement_opt_in, null);
  assert.equal(adsIngestEvent(row, { stage: "sold", value: 100, at: new Date("2026-10-06T10:00:00Z"), uploadAt: new Date("2026-10-06T10:00:00Z") }).event, null);
  assert.equal(ga4Payload(row, "generate_lead", { now: new Date("2026-10-06T10:00:00Z") }).payload, null);
});

test("the notice wording a person saw is stored with the lead, and the marketing box is off unless it was ticked", async () => {
  const t = await boot();
  await fetch(t.base + "/api/lead", { method: "POST", body: formData({ consent_text_version: "privacy-2026-10-2", submission_id: "a" }) });
  await fetch(t.base + "/api/lead", { method: "POST", body: formData({ consent_text_version: "privacy-2026-10-2", marketing_opt_in: "yes", submission_id: "b" }) });
  const [plain, opted] = t.ledger.all();
  assert.equal(plain.consent_version, "privacy-2026-10-2"); assert.equal(plain.marketing_opt_in, 0, "unticked means no marketing");
  assert.equal(opted.marketing_opt_in, 1);
  await t.close();
});

test("the honeypot gets a success and nothing is stored; bad input gets a clear error and nothing is stored", async () => {
  const t = await boot();
  assert.equal((await fetch(t.base + "/api/lead", { method: "POST", body: formData({ website: "http://spam.example" }) })).status, 200);
  assert.equal(t.ledger.count(), 0);
  for (const bad of [{ phone: "12" }, { name: "A" }, { message: "" }, { email: "nope" }]) {
    const r = await fetch(t.base + "/api/lead", { method: "POST", body: formData(bad) });
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
  assert.equal(t.ledger.count(), 0);
  await t.close();
});

test("MUTANT: a mistyped form does not use up its Turnstile token (Cloudflare accepts a token once), so the corrected resend with the same token is accepted", async () => {
  const used = new Set<string>();
  const t = await boot({ turnstileVerify: async (token) => { if (used.has(token)) return false; used.add(token); return token !== ""; } });
  assert.equal((await fetch(t.base + "/api/lead", { method: "POST", body: formData({ "cf-turnstile-response": "T1", phone: "123" }) })).status, 400);
  assert.equal((await fetch(t.base + "/api/lead", { method: "POST", body: formData({ "cf-turnstile-response": "T1" }) })).status, 200);
  assert.equal((await fetch(t.base + "/api/lead", { method: "POST", body: formData({ "cf-turnstile-response": "T1", submission_id: "zz" }) })).status, 400, "a token still cannot be used twice for stored requests");
  assert.equal(t.ledger.count(), 1);
  await t.close();
});

test("Turnstile is enforced server side when configured", async () => {
  const t = await boot({ turnstileVerify: async (token) => token === "good-token" });
  assert.equal((await fetch(t.base + "/api/lead", { method: "POST", body: formData() })).status, 400);
  assert.equal((await fetch(t.base + "/api/lead", { method: "POST", body: formData({ "cf-turnstile-response": "good-token" }) })).status, 200);
  assert.equal(t.ledger.count(), 1);
  await t.close();
});

test("rate limiting stops a burst from one address", async () => {
  const t = await boot({ rateLimit: { max: 2, windowSeconds: 60 } });
  const codes: number[] = [];
  for (let i = 0; i < 4; i++) codes.push((await fetch(t.base + "/api/lead", { method: "POST", body: formData({ phone: `604-555-01${10 + i}` }) })).status);
  assert.deepEqual(codes, [200, 200, 429, 429]);
  await t.close();
});

test("a caller cannot walk past the rate limit by inventing X-Forwarded-For, unless the receiver is told it sits behind a proxy", async () => {
  const send = (t: Awaited<ReturnType<typeof boot>>, i: number) => fetch(t.base + "/api/lead", { method: "POST", headers: { "x-forwarded-for": `203.0.113.${i}` }, body: formData({ phone: `604-555-02${10 + i}`, submission_id: `x${i}` }) }).then((r) => r.status);
  const direct = await boot({ rateLimit: { max: 2, windowSeconds: 60 } });
  assert.deepEqual([await send(direct, 1), await send(direct, 2), await send(direct, 3), await send(direct, 4)], [200, 200, 429, 429], "the spoofed header is ignored");
  await direct.close();
  const proxied = await boot({ rateLimit: { max: 2, windowSeconds: 60 }, trustProxyHeader: true });
  assert.deepEqual([await send(proxied, 1), await send(proxied, 2), await send(proxied, 3)], [200, 200, 200], "behind a trusted proxy each real client address has its own budget");
  await proxied.close();
});

test("no CORS header is sent unless an origin is configured", async () => {
  const t = await boot();
  const r = await fetch(t.base + "/api/lead", { method: "OPTIONS" });
  assert.equal(r.headers.get("access-control-allow-origin"), null);
  await t.close();
  const t2 = await boot({ allowOrigin: "https://example.test" });
  assert.equal((await fetch(t2.base + "/api/lead", { method: "OPTIONS" })).headers.get("access-control-allow-origin"), "https://example.test");
  await t2.close();
});

test("the outbox retries with backoff and the lead exists even if the first sends fail", async () => {
  const t = await boot();
  await fetch(t.base + "/api/lead", { method: "POST", body: formData() });
  const t0 = new Date();
  let calls = 0;
  const send = async () => { if (++calls < 3) throw new Error("smtp down"); };
  assert.deepEqual(await drainOutbox(t.ledger, send, new Date(t0.getTime() + 1000)), { sent: 0, failed: 1 });
  assert.equal(t.ledger.count(), 1, "the lead is safe while the email fails");
  assert.deepEqual(await drainOutbox(t.ledger, send, new Date(t0.getTime() + 2000)), { sent: 0, failed: 0 }, "not due yet: backoff holds");
  assert.deepEqual(await drainOutbox(t.ledger, send, new Date(Date.now() + 3600_000)), { sent: 0, failed: 1 });
  assert.deepEqual(await drainOutbox(t.ledger, send, new Date(Date.now() + 2 * 3600_000)), { sent: 1, failed: 0 });
  assert.equal(t.ledger.pending(), 0);
  await t.close();
});

test("reconcile fills the gap left by webhooks CallRail never resent, and is idempotent", async () => {
  const ledger = new Ledger();
  for (let i = 1; i <= 10; i++) if (i !== 4 && i !== 9) ledger.insert(parseCall(JSON.parse(callBody(i))));
  assert.equal(ledger.count("call"), 8);
  const api = async () => Array.from({ length: 10 }, (_, k) => JSON.parse(callBody(k + 1)));
  const first = await reconcileCalls(ledger, api, "2026-10-01T00:00:00Z");
  assert.equal(first.checked, 10); assert.equal(first.missing, 2); assert.equal(ledger.count("call"), 10);
  const second = await reconcileCalls(ledger, api, "2026-10-01T00:00:00Z");
  assert.equal(second.missing, 0); assert.equal(ledger.count("call"), 10);
});

test("a lead moves new -> estimate -> sold and never backwards", () => {
  const l = new Ledger();
  const { id } = l.insert(parseCall(JSON.parse(callBody(1))));
  l.setStage(id, "estimate", { value: 18500 });
  l.setStage(id, "sold", { value: 17900, at: "2026-10-20T00:00:00Z" });
  assert.equal(l.get(id)?.stage, "sold");
  assert.throws(() => l.setStage(id, "estimate", { value: 1 }), /cannot go back/);
  assert.deepEqual(l.findByPhone("+16045550100").map((r) => r.id), [id]);
});

test("GA4 payload: a recent event keeps its timestamp, an old one drops it and says why, a lead without a client id cannot be sent", () => {
  const l = new Ledger();
  const { id } = l.insert({ ...parseForm({ id: 9, form_data: { name: "Ana", phone: "604-555-0188" }, landing_page_url: "https://x.example/?utm_source=google", submitted_at: "2026-10-05T10:00:00Z" }), gaClientId: "111.222", measurementOptIn: true });
  const row = l.get(id)!;
  const recent = ga4Payload(row, "generate_lead", { value: 0, at: new Date("2026-10-05T10:00:00Z"), now: new Date("2026-10-06T10:00:00Z") });
  assert.ok(recent.payload?.timestamp_micros);
  assert.equal(recent.payload?.events[0].params.lead_source, "google");
  const old = ga4Payload(row, "close_convert_lead", { value: 17900, at: new Date("2026-10-05T10:00:00Z"), now: new Date("2026-10-26T10:00:00Z") });
  assert.equal(old.payload?.timestamp_micros, undefined);
  assert.match(old.note, /only accepts up to 72/);
  const { id: id2 } = l.insert(parseCall(JSON.parse(callBody(2))));
  assert.equal(ga4Payload(l.get(id2)!, "generate_lead").payload, null);
});


test("a pasted line break in a name cannot become a second email header, the fields are capped, and a client-made submission id must be a UUID", async () => {
  const t = await boot();
  const LF = String.fromCharCode(10);
  const r = await fetch(t.base + "/api/lead", { method: "POST", body: formData({ name: "Ana" + LF + "Bcc: evil@example.com", submission_id: "not-a-uuid", utm_source: "x".repeat(500) }) });
  assert.equal(r.status, 200);
  const out = JSON.parse((t.ledger.db.prepare("SELECT payload FROM outbox").get() as { payload: string }).payload);
  assert.equal(out.subject.includes(LF), false); assert.equal(out.subject, "New quote request from Ana Bcc: evil@example.com");
  const row = t.ledger.all()[0];
  assert.match(row.source_event_id, /^site-[0-9a-f-]{36}$/); assert.equal((row.utm_source ?? "").length, 100);
  const same = "7b0f9c2e-4d5a-4c1b-9e3f-2a6d8c1b0f44";
  await fetch(t.base + "/api/lead", { method: "POST", body: formData({ submission_id: same }) });
  await fetch(t.base + "/api/lead", { method: "POST", body: formData({ submission_id: same }) });
  assert.equal(t.ledger.count(), 2, "a double click with the same UUID stores one lead");
  await t.close();
});

test("a JSON body is refused with 415, an empty signing key refuses to start, and with a replay window a webhook with no readable timestamp is refused", async () => {
  const t = await boot({ replayWindowSeconds: 300 });
  const j = await fetch(t.base + "/api/lead", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(j.status, 415);
  const body = callBody(31, { start_time: undefined });
  const r = await fetch(t.base + "/callrail/post-call", { method: "POST", headers: { Signature: sign(body, KEY) }, body });
  assert.equal(r.status, 400);
  assert.equal(t.ledger.count(), 0);
  await t.close();
  assert.throws(() => createReceiver({ ledger: new Ledger(), signingKey: "", ownerEmail: "o@example.com" }), /signingKey is empty/);
});

test("two drains never send the same message twice", async () => {
  const l = new Ledger();
  const { id } = l.insert(parseCall(JSON.parse(callBody(40))));
  l.enqueue(id, "email", { to: "o@example.com", subject: "s", text: "t" });
  let sends = 0;
  const slow = async () => { sends++; await new Promise((r) => setTimeout(r, 20)); };
  const [a, b] = await Promise.all([drainOutbox(l, slow), drainOutbox(l, slow)]);
  assert.equal(sends, 1); assert.equal(a.sent + b.sent, 1);
});
