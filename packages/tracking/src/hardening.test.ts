// Tests added after an adversarial review mutated the code and found the suite stayed green: each test here fails against one of those mutations.
import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Ledger, parseCall, createReceiver, sign, toE164, sha256, ga4Payload, adsIngestEvent, adsIngestRequest, startServer, cleanLine } from "./index.ts";

const call = (id: string, phone = "+16045550100", extra: Record<string, unknown> = {}) => ({ id, customer_phone_number: phone, customer_name: "Test Caller", tracking_phone_number: "+17785550101", start_time: new Date(Date.parse("2026-10-05T21:03:00Z") + (Number(String(id).replace(/[^0-9]/g, "")) % 5000 + [...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0)) * 60000).toISOString(), source: "Google Ads", landing_page_url: "https://x.example/?gclid=Cj0abc", first_call: true, ...extra });
const CRLF = String.fromCharCode(13, 10);

function rawRequest(port: number, requestLine: string): Promise<string> {
  return new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1", () => s.write(`${requestLine}${CRLF}Host: x${CRLF}Connection: close${CRLF}${CRLF}`));
    let data = "";
    s.on("data", (d) => (data += d)); s.on("close", () => resolve(data)); s.on("error", () => resolve(data));
    setTimeout(() => { s.destroy(); resolve(data); }, 2000);
  });
}

test("MUTANT: a malformed request target gets a 400 and the receiver stays up (it used to end the whole process)", async () => {
  const server = createReceiver({ ledger: new Ledger(), signingKey: "k", ownerEmail: "o@example.com" });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as net.AddressInfo).port;
  for (const target of ["//:", "http://[", "//x:99999999/p"]) {
    const reply = await rawRequest(port, `GET ${target} HTTP/1.1`);
    assert.match(reply, /^HTTP\/1\.1 400/, `${target} must be refused with 400, got: ${reply.slice(0, 40)}`);
  }
  const health = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(health.status, 200, "the receiver is still serving after the bad requests");
  server.closeAllConnections(); server.close();
});

test("a JSON null or array body is a 400, not a 500, even with a replay window", async () => {
  const server = createReceiver({ ledger: new Ledger(), signingKey: "k", ownerEmail: "o@example.com", replayWindowSeconds: 300 });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as net.AddressInfo).port;
  for (const body of ["null", "[1,2]", "7"]) {
    const r = await fetch(`http://127.0.0.1:${port}/callrail/post-call`, { method: "POST", headers: { Signature: sign(body, "k") }, body });
    assert.equal(r.status, 400, body);
  }
  server.closeAllConnections(); server.close();
});

test("MUTANT: after the purge the personal data is gone from the database FILE, not only from the tables", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-purge-"));
  const file = path.join(dir, "ledger.sqlite");
  const l = new Ledger(file);
  const old = new Date("2023-01-01T00:00:00Z");
  const { id } = l.insert({ ...parseCall(call("OLD1", "+16045559876", { customer_name: "Zed Unique" })), email: "zed.unique@example.com" }, old);
  l.enqueue(id, "email", { text: "Zed Unique 12 Elm Street +16045559876" }, old);
  l.insert(parseCall(call("NEW1")), new Date("2026-10-01T00:00:00Z"));
  const r = l.purgeOlderThan(24, new Date("2026-10-12T00:00:00Z"));
  assert.deepEqual([r.leads, r.outbox], [1, 1], "an unsent outbox row goes too, with no foreign-key error");
  assert.equal(l.count(), 1);
  l.db.close();
  for (const f of fs.readdirSync(dir)) {
    const bytes = fs.readFileSync(path.join(dir, f)).toString("latin1");
    for (const secret of ["+16045559876", "Zed Unique", "12 Elm Street", "Cj0abc" + "XX"]) assert.equal(bytes.includes(secret), false, `${secret} is still in ${f}`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the outbox backoff is capped at four hours and a message that failed 12 times stops being retried", () => {
  const l = new Ledger();
  const { id } = l.insert(parseCall(call("OB1")));
  const ob = l.enqueue(id, "email", { text: "x" });
  const now = new Date("2026-10-12T00:00:00Z");
  for (let i = 0; i < 11; i++) l.markFailed(ob, "boom", now);
  const row = l.db.prepare("SELECT attempts, next_attempt_at FROM outbox WHERE id = ?").get(ob) as { attempts: number; next_attempt_at: string };
  assert.equal(row.attempts, 11);
  assert.ok(new Date(row.next_attempt_at).getTime() - now.getTime() <= 4 * 3600 * 1000, "wait never exceeds four hours");
  assert.equal(l.due(new Date(now.getTime() + 5 * 3600 * 1000)).length, 1, "still retried at 11 attempts");
  l.markFailed(ob, "boom", now);
  assert.equal(l.due(new Date(now.getTime() + 48 * 3600 * 1000)).length, 0, "dead after 12 attempts");
});

test("a lead cannot be moved backwards from estimate to new", () => {
  const l = new Ledger();
  const { id } = l.insert(parseCall(call("ST1")));
  l.setStage(id, "estimate", { value: 100 });
  assert.throws(() => l.setStage(id, "new"), /cannot go back/);
});

test("MUTANT: phone numbers: an extension is not part of the number, a leading 0 country code and a foreign 11 digit number are refused", () => {
  assert.equal(toE164("604-555-0142 ext. 1234"), "+16045550142");
  assert.equal(toE164("(604) 555-0142 x12"), "+16045550142");
  assert.equal(toE164("+1 604 555 0142 #77"), "+16045550142");
  assert.equal(toE164("+0123456789"), null);
  assert.equal(toE164("44123456789"), null, "an 11 digit number that does not start with the default country code is not guessed at");
  assert.equal(toE164("604-555-0142"), "+16045550142");
});

test("MUTANT: cleanLine strips every line break, including the Unicode ones", () => {
  assert.equal(cleanLine("a" + String.fromCharCode(0x2028) + "b" + String.fromCharCode(0x2029) + "c", 50), "a b c");
  assert.equal(cleanLine("x".repeat(500), 100).length, 100);
});

test("MUTANT: the Ads event carries the exact values Google needs: hashed phone, WEB for a form and PHONE for a call, both consent fields", () => {
  const l = new Ledger();
  const { id: callId } = l.insert(parseCall(call("AD1", "+16045550177")));
  const row = l.get(callId)!;
  const at = new Date(new Date(row.occurred_at).getTime() + 5 * 86400000);
  const phone = adsIngestEvent({ ...row, gclid: null }, { stage: "sold", value: 100, at, uploadAt: at });
  assert.deepEqual(phone.event?.userData?.userIdentifiers, [{ phoneNumber: sha256("+16045550177") }], "the phone goes up as a SHA-256 hex hash, never as typed");
  assert.equal(phone.event?.eventSource, "PHONE");
  const form = adsIngestEvent({ ...row, kind: "form" }, { stage: "sold", value: 100, at, uploadAt: at });
  assert.equal(form.event?.eventSource, "WEB");
  const granted = adsIngestRequest({ operatingAccountId: "1", conversionActionId: "2" }, [form.event!], { consent: true });
  assert.deepEqual(granted.consent, { adUserData: "CONSENT_GRANTED", adPersonalization: "CONSENT_GRANTED" });
  const denied = adsIngestRequest({ operatingAccountId: "1", conversionActionId: "2" }, [form.event!], { consent: false });
  assert.deepEqual(denied.consent, { adUserData: "CONSENT_DENIED", adPersonalization: "CONSENT_DENIED" });
});

test("MUTANT: the GA4 timestamp is in MICROseconds and exact, and an event dated in the future is sent without one", () => {
  const l = new Ledger();
  const { id } = l.insert({ ...parseCall(call("GA1")), gaClientId: "1.2" });
  const row = l.get(id)!;
  const now = new Date("2026-10-05T22:00:00Z");
  const at = new Date("2026-10-05T21:00:00Z");
  assert.equal(ga4Payload(row, "generate_lead", { at, now }).payload?.timestamp_micros, at.getTime() * 1000);
  const future = ga4Payload(row, "generate_lead", { at: new Date(now.getTime() + 2 * 3600 * 1000), now });
  assert.equal(future.payload?.timestamp_micros, undefined);
});

function fakeCallRail(pages: Record<string, unknown>[][]): { fetch: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const f = (async (url: string) => {
    urls.push(String(url));
    const page = Number(new URL(String(url)).searchParams.get("page"));
    return new Response(JSON.stringify({ calls: pages[page - 1] ?? [] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetch: f, urls };
}

test("MUTANT: the reconcile reads every page, not only the first, and a server run fills calls the webhook missed", async () => {
  const mk = (from: number, n: number) => Array.from({ length: n }, (_, i) => call(`R${from + i}`, "+1604555" + String(1000 + from + i).slice(-4)));
  const cr = fakeCallRail([mk(0, 100), mk(100, 3)]);
  const run = await startServer({ CALLRAIL_SIGNING_KEY: "k", OWNER_EMAIL: "o@example.com", PORT: "0", LEDGER_PATH: ":memory:", CALLRAIL_API_KEY: "key", CALLRAIL_ACCOUNT_ID: "ACC1" }, () => {}, { fetch: cr.fetch });
  await run.jobs.reconcile();
  assert.equal(run.ledger.count("call"), 103, "both pages were read");
  assert.equal(cr.urls.length >= 2, true);
  assert.match(cr.urls[0], /\/a\/ACC1\/calls\.json\?start_date=\d{4}-\d{2}-\d{2}&per_page=100&page=1/);
  await run.stop();
});

test("MUTANT: the server's start-up purge removes leads past the retention period (and keeps newer ones)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-srv-"));
  const file = path.join(dir, "l.sqlite");
  const seed = new Ledger(file);
  seed.insert(parseCall(call("OLDX")), new Date("2020-01-01T00:00:00Z"));
  seed.insert(parseCall(call("NEWX")), new Date());
  seed.db.close();
  const run = await startServer({ CALLRAIL_SIGNING_KEY: "k", OWNER_EMAIL: "o@example.com", PORT: "0", LEDGER_PATH: file, RETENTION_MONTHS: "24" }, () => {});
  assert.equal(run.ledger.count(), 1, "the 2020 lead is gone, the new one stays");
  await run.stop();
  run.ledger.db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
