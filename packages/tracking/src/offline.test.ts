import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256, normaliseEmail, parseCall, Ledger, ga4Payload, adsIngestEvent, adsIngestRequest, leadsNearingClickExpiry, reconcileCalls } from "./index.ts";

const DAY = 24 * 3600 * 1000;
const call = (id: number, extra: Record<string, unknown> = {}) => ({ id: `CAL${id}`, customer_phone_number: "+16045550100", customer_name: "Test Caller", tracking_phone_number: "+17785550101", start_time: "2026-10-05T14:03:00-07:00", source: "Google Ads", landing_page_url: "https://seabreeze-roofing.example/projects/?gclid=Cj0abc&utm_source=google&utm_medium=cpc", first_call: true, ...extra });
const lead = (extra: Record<string, unknown> = {}) => { const l = new Ledger(); const { id } = l.insert(parseCall(call(1, extra))); return { l, row: l.get(id)! }; };
const after = (row: { occurred_at: string }, days: number) => new Date(new Date(row.occurred_at).getTime() + days * DAY);

test("Ads offline conversion (Data Manager API): one click id, hashed identifiers, ISO time in Vancouver, PHONE source, request defaults to validateOnly", () => {
  const { l, row } = lead({ gbraid: "GB1" });
  const row2 = { ...row, gbraid: "GB1" };
  const { event } = adsIngestEvent(row2, { stage: "sold", value: 17900, at: after(row, 20), uploadAt: after(row, 20), email: "Ana.Smith@Gmail.com" });
  assert.equal(event?.adIdentifiers?.gclid, "Cj0abc");
  assert.equal(event?.adIdentifiers?.gbraid, undefined, "only one click id is sent");
  assert.match(event!.eventTimestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-0[78]:00$/);
  assert.equal(event?.eventSource, "PHONE", "the reference's enum has PHONE, not CALL");
  assert.equal(event?.transactionId, `lead-${row.id}-sold`);
  const email = event!.userData!.userIdentifiers[0] as { emailAddress: string };
  assert.equal(email.emailAddress, sha256("anasmith@gmail.com"), "gmail dots are removed before hashing");
  const req = adsIngestRequest({ operatingAccountId: "1234567890", conversionActionId: "555" }, [event!], { consent: true });
  assert.equal(req.validateOnly, true); assert.equal(req.encoding, "HEX"); assert.equal(req.destinations[0].productDestinationId, "555");
  assert.equal(adsIngestRequest({ operatingAccountId: "1", conversionActionId: "2" }, [event!], { validateOnly: false, consent: false }).consent.adUserData, "CONSENT_DENIED");
  void l;
  // British Columbia moved to permanent daylight time on 2026-03-08 (UTC-7 all year, tzdata 2026b)
  const dec = adsIngestEvent({ ...row, occurred_at: "2026-11-25T20:00:00Z" }, { stage: "sold", value: 1, at: new Date("2026-12-01T20:00:00Z"), uploadAt: new Date("2026-12-01T20:00:00Z") });
  assert.match(dec.event!.eventTimestamp, /-07:00$/);
  const jan = adsIngestEvent({ ...row, occurred_at: "2026-01-10T20:00:00Z" }, { stage: "sold", value: 1, at: new Date("2026-01-15T20:00:00Z"), uploadAt: new Date("2026-01-15T20:00:00Z") });
  assert.match(jan.event!.eventTimestamp, /-08:00$/);
});

test("the Gmail rules: dots and a plus suffix are dropped, whitespace is removed, other domains are only lower-cased, and the ledger hash matches the Ads hash", () => {
  assert.equal(normaliseEmail(" Jane.Doe+Roof@Gmail.com "), "janedoe@gmail.com");
  assert.equal(normaliseEmail("a. b@googlemail.com"), "ab@googlemail.com");
  assert.equal(normaliseEmail("Jane.Doe+Roof@Example.COM"), "jane.doe+roof@example.com");
  const l = new Ledger();
  const ev = parseCall(call(7));
  const { id } = l.insert({ ...ev, kind: "form", sourceEventId: "f1", email: "Jane.Doe+Roof@Gmail.com" });
  assert.equal(l.get(id)!.email_sha256, sha256("janedoe@gmail.com"));
});

test("Ads: the 90 and 63 day limits are measured from the click to the UPLOAD, in milliseconds, and the dates must make sense", () => {
  const { row } = lead();
  const up = (days: number) => ({ stage: "sold" as const, value: 10, at: after(row, 1), uploadAt: after(row, days), email: "a@b.co" });
  const fresh = adsIngestEvent(row, up(10));
  assert.ok(fresh.event?.adIdentifiers?.gclid && fresh.event?.userData);
  const edge63 = adsIngestEvent(row, up(63));
  assert.ok(edge63.event?.userData, "exactly 63 days is still inside");
  const over63 = adsIngestEvent(row, { ...up(0), uploadAt: new Date(after(row, 63).getTime() + 1000) });
  assert.equal(over63.event?.userData, undefined, "one second past 63 days is out, not rounded down to 63");
  assert.match(over63.note, /63 days/);
  assert.equal(adsIngestEvent(row, { ...up(0), uploadAt: new Date(after(row, 90).getTime() + 1000) }).event, null);
  assert.match(adsIngestEvent(row, up(95)).note, /90 days/);
  // a backdated conversion time does not hide an old click: the upload date decides
  const backdated = adsIngestEvent(row, { stage: "sold", value: 10, at: after(row, 10), uploadAt: after(row, 120) });
  assert.equal(backdated.event, null, "the click is far older than 90 days at upload time, whatever date the conversion carries");
  assert.match(adsIngestEvent(row, { stage: "sold", value: 10, at: after(row, -5), uploadAt: after(row, 1) }).note, /before the click/);
  assert.match(adsIngestEvent({ ...row, occurred_at: "garbage" }, up(1)).note, /not a valid date/);
  assert.match(adsIngestEvent(row, { stage: "sold", value: 10, at: new Date("invalid") }).note, /not a valid date/);
  assert.match(adsIngestEvent(row, { stage: "sold", value: -1 }).note, /zero or more/);
  assert.equal(adsIngestEvent({ ...row, gclid: null, phone_e164: null }, up(1)).event?.adIdentifiers, undefined);
  const noClick = adsIngestEvent({ ...row, gclid: null }, up(30));
  assert.equal(noClick.event?.adIdentifiers, undefined); assert.match(noClick.note, /phone and email/);
});

test("Ads: an estimate and a sold job never share a transaction id, and a revised value updates the same one", () => {
  const { row } = lead();
  const base = { value: 12000, at: after(row, 5), uploadAt: after(row, 5) };
  const est = adsIngestEvent(row, { ...base, stage: "estimate" }).event!;
  const sold = adsIngestEvent(row, { ...base, stage: "sold" }).event!;
  const revised = adsIngestEvent(row, { ...base, stage: "sold", value: 12500 }).event!;
  assert.notEqual(est.transactionId, sold.transactionId);
  assert.equal(sold.transactionId, revised.transactionId);
});

test("leads still waiting on an outcome are flagged near the limit; a sold one is not", () => {
  const { row } = lead();
  const waiting = [{ ...row, stage: "estimate" as const }, { ...row, id: 99, stage: "sold" as const }];
  assert.deepEqual(leadsNearingClickExpiry(waiting, after(row, 60)).map((r) => r.id), [row.id]);
  assert.deepEqual(leadsNearingClickExpiry(waiting, after(row, 20)), []);
  assert.deepEqual(leadsNearingClickExpiry([{ ...row, occurred_at: "garbage" }], after(row, 60)), [], "an unreadable date is not silently treated as a match");
});

test("GA4: currency travels with value, lead_source only on generate_lead, session_id only within 24 hours", () => {
  const l = new Ledger();
  const { id } = l.insert({ ...parseCall(call(2)), gaClientId: "111.222" });
  const row = l.get(id)!;
  const t = new Date("2026-10-05T14:03:00-07:00");
  const noValue = ga4Payload(row, "generate_lead", { at: t, now: t }).payload!.events[0].params;
  assert.equal("currency" in noValue, false); assert.equal(noValue.lead_source, "google");
  const sold = ga4Payload(row, "close_convert_lead", { value: 100, at: t, now: t, sessionId: 5 }).payload!.events[0].params;
  assert.equal(sold.currency, "CAD"); assert.equal(sold.lead_source, undefined); assert.equal(sold.session_id, 5);
  const late = ga4Payload(row, "close_convert_lead", { value: 100, at: t, now: new Date(t.getTime() + 30 * DAY), sessionId: 5 }).payload!.events[0].params;
  assert.equal(late.session_id, undefined);
});

test("the ledger: a webhook racing the reconcile reads 'already stored' instead of throwing, and reconcile keeps going", async () => {
  const l = new Ledger();
  const ev = parseCall(call(3));
  const first = l.insert(ev);
  const second = l.insert(ev);
  assert.deepEqual([first.inserted, second.inserted, second.id], [true, false, first.id]);
  const rep = await reconcileCalls(l, async () => [call(3), call(4), call(5)], "2026-10-01T00:00:00Z");
  assert.deepEqual([rep.checked, rep.missing], [3, 2]);
  assert.equal(l.count("call"), 3);
});

test("raw_json keeps only allow-listed fields: no names, formatted numbers, notes, transcriptions or form answers", () => {
  const l = new Ledger();
  const { id } = l.insert(parseCall(call(6, { formatted_customer_name: "Marguerite Tallow", formatted_customer_phone_number: "604-555-0100", note: "Spoke to Marguerite at 4471 Birchwood Crescent", transcription: "my address is 4471 Birchwood Crescent", voicemail: "hello", recording: "https://x" })));
  const raw = (l.db.prepare("SELECT raw_json FROM leads WHERE id = ?").get(id) as { raw_json: string }).raw_json;
  for (const bad of ["Tallow", "Birchwood", "604-555-0100", "recording", "transcription", "voicemail", "Test Caller"]) assert.equal(raw.includes(bad), false, bad);
  assert.ok(raw.includes("CAL6"));
  const f = new Ledger();
  const { id: fid } = f.insert({ ...parseCall(call(8)), kind: "form", sourceEventId: "F8", raw: { id: "F8", form_data: { Cell: "604-555-0111", "E-mail": "a@b.co", "Street address": "12 Elm Street" }, landing_page_url: "https://x.example/" } });
  const fraw = (f.db.prepare("SELECT raw_json FROM leads WHERE id = ?").get(fid) as { raw_json: string }).raw_json;
  for (const bad of ["604-555-0111", "a@b.co", "Elm Street"]) assert.equal(fraw.includes(bad), false, bad);
  assert.ok(fraw.includes("form_field_names"));
});

test("the outbox: a sent message body is blanked, two drains cannot claim one row, an unknown id does not throw, and the 24 month promise is kept by a purge", () => {
  const l = new Ledger();
  const { id } = l.insert(parseCall(call(9)));
  const ob = l.enqueue(id, "email", { text: "Ana Souza 604 555 0188 12 Elm Street" });
  assert.equal(l.claim(ob), true); assert.equal(l.claim(ob), false, "the second drain loses the claim");
  l.markSent(ob);
  assert.equal((l.db.prepare("SELECT payload FROM outbox WHERE id = ?").get(ob) as { payload: string }).payload, "{}");
  l.markFailed(99999, "x");
  const old = new Date("2024-01-01T00:00:00Z");
  l.insert(parseCall(call(10)), old);
  const r = l.purgeOlderThan(24, new Date("2026-10-12T00:00:00Z"));
  assert.equal(r.leads, 1); assert.equal(l.count(), 1);
});

test("stage changes are validated: no negative value, no invalid date, no change after sold or lost", () => {
  const { l, row } = lead();
  assert.throws(() => l.setStage(row.id, "estimate", { value: -5 }), /zero or more/);
  assert.throws(() => l.setStage(row.id, "sold", { value: 10, at: "garbage" }), /not a valid date/);
  l.setStage(row.id, "sold", { value: 10 });
  assert.throws(() => l.setStage(row.id, "lost"), /cannot change/);
});

test("the runnable server refuses to start without its key, starts with one, answers /health, and stores a signed webhook", async () => {
  const { startServer } = await import("./server.ts");
  await assert.rejects(startServer({ OWNER_EMAIL: "o@example.com" }, () => {}), /CALLRAIL_SIGNING_KEY and OWNER_EMAIL are required/);
  await assert.rejects(startServer({ CALLRAIL_SIGNING_KEY: "k", OWNER_EMAIL: "o@example.com", RETENTION_MONTHS: "0" }, () => {}), /RETENTION_MONTHS/);
  const run = await startServer({ CALLRAIL_SIGNING_KEY: "k", OWNER_EMAIL: "o@example.com", PORT: "0", LEDGER_PATH: ":memory:" }, () => {});
  const port = (run.server.address() as { port: number }).port;
  const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json() as { ok: boolean; leads: number };
  assert.deepEqual([health.ok, health.leads], [true, 0]);
  const { sign } = await import("./index.ts");
  const body = JSON.stringify({ id: "CALSRV1", customer_phone_number: "+16045550100", start_time: new Date().toISOString(), landing_page_url: "https://x.example/?gclid=G1" });
  const r = await fetch(`http://127.0.0.1:${port}/callrail/post-call`, { method: "POST", headers: { Signature: sign(body, "k") }, body });
  assert.equal(r.status, 200); assert.equal(run.ledger.count(), 1);
  await run.stop();
});
