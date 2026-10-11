import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { sign, verifySignature, toE164, clickIds, parseCall, parseForm, Ledger, createReceiver, drainOutbox, sha256, ga4Payload, adsIngestEvent, adsIngestRequest, leadsNearingClickExpiry, reconcileCalls } from "./index.ts";

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
  const out = JSON.parse((t.ledger.db.prepare("SELECT payload FROM outbox").get() as { payload: string }).payload);
  assert.equal(out.text.includes("Page:"), false);
  assert.equal(adsIngestEvent(row, { stage: "sold", value: 100 }).event, null);
  assert.equal(ga4Payload(row, "generate_lead").payload, null);
  assert.match(adsIngestEvent(row, { stage: "sold", value: 100 }).note, /did not tick the measurement box/);
  await t.close();
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
