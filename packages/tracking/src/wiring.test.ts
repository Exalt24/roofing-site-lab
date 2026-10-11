// Tests for the wiring the second review found untested: the server's jobs, its settings, the click time, the purge while the database is open, and request chunking.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { Ledger, parseCall, sign, startServer, adsIngestEvent, adsIngestRequests, MAX_EVENTS_PER_REQUEST, createReceiver } from "./index.ts";

const call = (id: string, phone = "+16045550100") => ({ id, customer_phone_number: phone, customer_name: "T", tracking_phone_number: "+17785550101", start_time: new Date(Date.now() - (Number(id.replace(/[^0-9]/g, "")) % 5000 + 1) * 60000 - [...id].reduce((a, c) => a + c.charCodeAt(0), 0) * 1000).toISOString(), landing_page_url: "https://x.example/?gclid=G1", first_call: true });
const base = { CALLRAIL_SIGNING_KEY: "k", OWNER_EMAIL: "o@example.com", PORT: "0", LEDGER_PATH: ":memory:" };
const portOf = (r: { server: { address(): unknown } }) => (r.server.address() as AddressInfo).port;
const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries({ name: "Ana Souza", phone: "604-555-0188", message: "Water stain under the skylight", ...o })) f.set(k, v); return f; };

test("MUTANT: the server drains the outbox to the notify webhook, counts a failure as a failure, and does not drain when no webhook is set", async () => {
  const sent: { url: string; body: string }[] = [];
  let fail = true;
  const fetchStub = (async (url: string, init: RequestInit) => { sent.push({ url: String(url), body: String(init.body) }); return new Response("", { status: fail ? 500 : 200 }); }) as unknown as typeof fetch;
  const run = await startServer({ ...base, NOTIFY_WEBHOOK_URL: "https://hooks.example/notify" }, () => {}, { fetch: fetchStub });
  const { id } = run.ledger.insert(parseCall(call("DR1")));
  run.ledger.enqueue(id, "email", { to: "o@example.com", subject: "s", text: "t" });
  await run.jobs.drain();
  assert.equal(sent.length, 1, "the webhook was called");
  assert.equal(run.ledger.pending(), 1, "a 500 leaves the message waiting");
  fail = false;
  run.ledger.db.prepare("UPDATE outbox SET next_attempt_at = ?").run(new Date(Date.now() - 1000).toISOString());
  await run.jobs.drain();
  assert.equal(run.ledger.pending(), 0, "a 200 marks it sent");
  await run.stop();
  const quiet = await startServer(base, () => {}, { fetch: fetchStub });
  const { id: id2 } = quiet.ledger.insert(parseCall(call("DR2")));
  quiet.ledger.enqueue(id2, "email", { to: "o@example.com", subject: "s", text: "t" });
  const before = sent.length;
  await quiet.jobs.drain();
  assert.equal(sent.length, before, "no webhook set, nothing is sent");
  await quiet.stop();
});

test("MUTANT: the reconcile uses the CallRail token header and looks back the configured number of days, in days", async () => {
  const seen: { url: string; auth: string }[] = [];
  const fetchStub = (async (url: string, init: RequestInit) => { seen.push({ url: String(url), auth: String((init.headers as Record<string, string>).Authorization) }); return new Response(JSON.stringify({ calls: [] }), { status: 200 }); }) as unknown as typeof fetch;
  const fixedNow = new Date("2026-10-12T12:00:00Z");
  const run = await startServer({ ...base, CALLRAIL_API_KEY: "abc123", CALLRAIL_ACCOUNT_ID: "ACC9", RECONCILE_LOOKBACK_DAYS: "5" }, () => {}, { fetch: fetchStub, now: () => fixedNow });
  seen.length = 0;
  await run.jobs.reconcile();
  assert.equal(seen[0].auth, 'Token token="abc123"');
  assert.match(seen[0].url, /start_date=2026-10-07&/, "12 October minus 5 days");
  await run.stop();
  await assert.rejects(startServer({ ...base, RECONCILE_LOOKBACK_DAYS: "0" }, () => {}), /RECONCILE_LOOKBACK_DAYS/);
  await assert.rejects(startServer({ ...base, RETENTION_MONTHS: "1.5" }, () => {}), /whole number/);
});

test("MUTANT: the start-up purge honours RETENTION_MONTHS (a 3 month old lead goes with 1 month, stays with 24)", async () => {
  for (const [months, kept] of [["1", 1], ["24", 2]] as const) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-ret-"));
    const file = path.join(dir, "l.sqlite");
    const seed = new Ledger(file);
    seed.insert(parseCall(call("RET-OLD")), new Date(Date.now() - 90 * 86400000));
    seed.insert(parseCall(call("RET-NEW")), new Date());
    seed.db.close();
    const run = await startServer({ ...base, LEDGER_PATH: file, RETENTION_MONTHS: months }, () => {});
    assert.equal(run.ledger.count(), kept, `RETENTION_MONTHS=${months}`);
    await run.stop(); run.ledger.db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the server enforces the form rate limit and the webhook replay window it is configured with", async () => {
  const run = await startServer(base, () => {});
  const port = portOf(run);
  const codes: number[] = [];
  for (let i = 0; i < 12; i++) codes.push((await fetch(`http://127.0.0.1:${port}/api/lead`, { method: "POST", body: form({ phone: `604-555-02${String(i).padStart(2, "0")}`, submission_id: `x${i}` }) })).status);
  assert.ok(codes.includes(429), `no 429 in ${codes.join(",")}`);
  const stale = JSON.stringify({ ...call("STALE1"), start_time: "2020-01-01T00:00:00Z" });
  const r = await fetch(`http://127.0.0.1:${port}/callrail/post-call`, { method: "POST", headers: { Signature: sign(stale, "k") }, body: stale });
  assert.equal(r.status, 409, "a webhook from 2020 is outside the 24 hour replay window");
  await run.stop();
});

test("MUTANT: a double click with the same submission id queues one email, and a body that is not a readable form is a 400", async () => {
  const run = await startServer(base, () => {});
  const port = portOf(run);
  const id = "7b0f9c2e-4d5a-4c1b-9e3f-2a6d8c1b0f44";
  await fetch(`http://127.0.0.1:${port}/api/lead`, { method: "POST", body: form({ submission_id: id }) });
  await fetch(`http://127.0.0.1:${port}/api/lead`, { method: "POST", body: form({ submission_id: id }) });
  assert.equal(run.ledger.count("form"), 1);
  assert.equal(run.ledger.pending(), 1, "one email, not two");
  const bad = await fetch(`http://127.0.0.1:${port}/api/lead`, { method: "POST", headers: { "content-type": "multipart/form-data; boundary=zzz" }, body: "this is not a multipart body" });
  assert.equal(bad.status, 400);
  await run.stop();
});

test("Turnstile: with a secret set the form needs a token Cloudflare accepts", async () => {
  const calls: string[] = [];
  const fetchStub = (async (url: string, init: RequestInit) => { calls.push(String(url)); const ok = String(init.body).includes("response=good"); return new Response(JSON.stringify({ success: ok }), { status: 200 }); }) as unknown as typeof fetch;
  const run = await startServer({ ...base, TURNSTILE_SECRET: "sec" }, () => {}, { fetch: fetchStub });
  const port = portOf(run);
  const none = await fetch(`http://127.0.0.1:${port}/api/lead`, { method: "POST", body: form({}) });
  assert.equal(none.status, 400, "no token");
  const bad = await fetch(`http://127.0.0.1:${port}/api/lead`, { method: "POST", body: form({ "cf-turnstile-response": "bad", submission_id: "a1" }) });
  assert.equal(bad.status, 400, "a token Cloudflare rejects");
  const good = await fetch(`http://127.0.0.1:${port}/api/lead`, { method: "POST", body: form({ "cf-turnstile-response": "good", submission_id: "a2" }) });
  assert.equal(good.status, 200);
  assert.ok(calls.every((u) => u.includes("challenges.cloudflare.com/turnstile/v0/siteverify")));
  await run.stop();
});

test("MUTANT: the click time travels with a form lead and the age limits count from it, not from the later form submission", () => {
  const l = new Ledger();
  const now = new Date("2026-10-12T12:00:00Z");
  const receiver = createReceiver({ ledger: l, signingKey: "k", ownerEmail: "o@example.com", now: () => now });
  return new Promise<void>((resolve, reject) => {
    receiver.listen(0, "127.0.0.1", async () => {
      try {
        const port = (receiver.address() as AddressInfo).port;
        const clicked = new Date(now.getTime() - 80 * 86400000).toISOString();
        const r = await fetch(`http://127.0.0.1:${port}/api/lead`, { method: "POST", body: form({ gclid: "G9", click_time: clicked, submission_id: "c1" }) });
        assert.equal(r.status, 200);
        const row = l.all()[0];
        assert.equal(row.click_at, clicked);
        // 80 days after the click, 0 days after the form: only the click time says the 63 day phone and email limit is past
        const ev = adsIngestEvent(row, { stage: "sold", value: 10, at: now, uploadAt: now, email: "a@b.co" });
        assert.equal(ev.event?.adIdentifiers?.gclid, "G9");
        assert.equal(ev.event?.userData, undefined, "past 63 days from the click, so no phone or email");
        assert.match(ev.note, /63 days/);
        const bad = await fetch(`http://127.0.0.1:${port}/api/lead`, { method: "POST", body: form({ gclid: "G8", click_time: "2099-01-01T00:00:00Z", submission_id: "c2" }) });
        assert.equal(bad.status, 200);
        assert.equal(l.all()[1].click_at, null, "a click time in the future is ignored");
        receiver.closeAllConnections(); receiver.close(); resolve();
      } catch (e) { receiver.closeAllConnections(); receiver.close(); reject(e); }
    });
  });
});

test("MUTANT: deleted and blanked text is gone from the database files while the connection is still OPEN", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-scrub-"));
  const file = path.join(dir, "ledger.sqlite");
  const l = new Ledger(file);
  const { id } = l.insert(parseCall(call("SC1", "+16045559876")), new Date());
  const ob = l.enqueue(id, "email", { text: "Marguerite Tallow 4471 Birchwood Crescent +16045559876" });
  const scan = (needles: string[], where: string) => {
    for (const f of fs.readdirSync(dir)) { const bytes = fs.readFileSync(path.join(dir, f)).toString("latin1"); for (const n of needles) assert.equal(bytes.includes(n), false, `${n} still in ${f} ${where}`); }
  };
  l.markSent(ob);
  scan(["Marguerite Tallow", "4471 Birchwood"], "after the message was sent, with the database open");
  l.insert(parseCall(call("SC2", "+16045551234")), new Date("2020-01-01T00:00:00Z"));
  const r = l.purgeOlderThan(24, new Date("2026-10-12T00:00:00Z"));
  assert.equal(r.scrubbed, true);
  scan(["+16045551234"], "after the purge, with the database open");
  l.db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a long list of conversions goes up in requests of at most 2,000 events", () => {
  const l = new Ledger();
  const { id } = l.insert({ ...parseCall(call("CH1")), gclid: "G1" });
  const row = l.get(id)!;
  const ev = adsIngestEvent(row, { stage: "sold", value: 1, at: new Date(), uploadAt: new Date() }).event!;
  const reqs = adsIngestRequests({ operatingAccountId: "1", conversionActionId: "2" }, Array.from({ length: 4001 }, () => ev), { consent: true });
  assert.deepEqual(reqs.map((r) => r.events.length), [MAX_EVENTS_PER_REQUEST, MAX_EVENTS_PER_REQUEST, 1]);
  assert.equal(reqs.every((r) => r.validateOnly), true);
});

test("MUTANT: the same call arriving under a numeric webhook id and a CAL... API id is stored once, and two different calls from one caller stay two rows", async () => {
  const l = new Ledger();
  const webhook = { ...call("766970532", "+16045550142"), start_time: "2026-10-05T14:03:00-07:00" };
  const api = { ...call("CAL8154748ae6bd4e278a7cddd38a662f4f", "+16045550142"), start_time: "2026-10-05T21:03:00.000Z" };
  const a = l.insert(parseCall(webhook));
  const b = l.insert(parseCall(api));
  assert.deepEqual([a.inserted, b.inserted, b.id], [true, false, a.id], "same caller, same second, different id: the same call");
  assert.equal(l.count("call"), 1);
  const later = l.insert(parseCall({ ...call("CALlater", "+16045550142"), start_time: "2026-10-05T14:09:00-07:00" }));
  assert.equal(later.inserted, true, "a second call from the same number minutes later is a new call");
  const other = l.insert(parseCall({ ...call("CALother", "+17785550999"), start_time: "2026-10-05T14:03:00-07:00" }));
  assert.equal(other.inserted, true, "another caller at the same moment is a new call");
  const { reconcileCalls } = await import("./index.ts");
  const rep = await reconcileCalls(l, async () => [api, { ...call("CALnew", "+16045550143"), start_time: "2026-10-06T10:00:00-07:00" }], "2026-10-01");
  assert.deepEqual([rep.checked, rep.missing], [2, 1], "the reconcile does not duplicate a call the webhook already stored");
});

test("MUTANT: a call lead says its age is counted from the call, a form lead with a click time does not, session_id must be a whole number, and an Ads account id loses its hyphens", async () => {
  const { ga4Payload, adsIngestRequest } = await import("./index.ts");
  const l = new Ledger();
  const { id } = l.insert({ ...parseCall(call("CAVEAT1")), gaClientId: "1.2" });
  const row = l.get(id)!;
  const at = new Date(new Date(row.occurred_at).getTime() + 86400000);
  assert.match(adsIngestEvent(row, { stage: "sold", value: 1, at, uploadAt: at }).note, /counted from the call time/);
  assert.equal(adsIngestEvent({ ...row, kind: "form", click_at: row.occurred_at }, { stage: "sold", value: 1, at, uploadAt: at }).note, "ok");
  const now = new Date(row.occurred_at);
  assert.equal(ga4Payload(row, "generate_lead", { at: now, now, sessionId: "12345" }).payload?.events[0].params.session_id, 12345);
  assert.equal(ga4Payload(row, "generate_lead", { at: now, now, sessionId: "abc" }).payload?.events[0].params.session_id, undefined);
  const req = adsIngestRequest({ operatingAccountId: "123-456-7890", conversionActionId: "9" }, [], { consent: true });
  assert.equal(req.destinations[0].operatingAccount.accountId, "1234567890");
});

test("MUTANT: when a payload carries both ids, the CAL... resource id is the key, so a later API row for the same call is an exact match; and two tracking numbers at the same second stay two calls", async () => {
  const l = new Ledger();
  const start = "2026-10-06T09:00:00.236-07:00";
  const webhook = { ...call("766970532", "+16045550150"), resource_id: "CAL0123456789abcdef0123456789abcdef012", start_time: start, tracking_phone_number: "+17785550101" };
  const a = l.insert(parseCall(webhook));
  assert.equal(l.get(a.id)!.source_event_id, "CAL0123456789abcdef0123456789abcdef012", "resource_id wins over the numeric id");
  const apiRow = { ...call("CAL0123456789abcdef0123456789abcdef012", "+16045550150"), start_time: "2026-10-06T16:00:00.900Z", tracking_phone_number: "+17785550101" };
  const b = l.insert(parseCall(apiRow));
  assert.deepEqual([b.inserted, b.id], [false, a.id]);
  const otherTracker = l.insert(parseCall({ ...call("CALsecondnumber", "+16045550150"), start_time: start, tracking_phone_number: "+17785550999" }));
  assert.equal(otherTracker.inserted, true, "the same caller reaching a different tracking number is a different call");
  assert.equal(l.count("call"), 2);
});
