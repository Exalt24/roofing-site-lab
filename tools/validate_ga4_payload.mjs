// Checks our GA4 Measurement Protocol payloads against Google's own validation server (/debug/mp/collect). Nothing sent here reaches a report; The default validation is RELAXED, which only rejects a malformed request; ENFORCE_RECOMMENDATIONS also rejects a timestamp older than 72 hours or a session_id of the wrong type, so that is what this tool asks for.
// the validation server also does not check the api_secret, so a placeholder is enough. A real send never errors on a bad payload, which is why this exists.
//   node tools/validate_ga4_payload.mjs [G-MEASUREMENTID]
import { Ledger, parseCall, ga4Payload } from "../packages/tracking/src/index.ts";

const measurementId = process.argv[2] ?? "G-ABCDE12345";
const ledger = new Ledger();
const call = parseCall({ id: "CALVALID1", customer_phone_number: "+16045550100", tracking_phone_number: "+17785550101", start_time: new Date().toISOString(), source: "Google Ads", landing_page_url: "https://seabreeze-roofing-lab.pages.dev/?gclid=test&utm_source=google&utm_medium=cpc", first_call: true });
const { id } = ledger.insert({ ...call, gaClientId: "1234567890.1234567890" });
const row = ledger.get(id);
const cases = [
  ["generate_lead", ga4Payload(row, "generate_lead", { value: 0 })],
  ["qualify_lead (estimate booked)", ga4Payload(row, "qualify_lead", { value: 0 })],
  ["close_convert_lead (sold)", ga4Payload(row, "close_convert_lead", { value: 17900 })],
];
let bad = 0;
for (const [label, { payload, note }] of cases) {
  if (!payload) { console.log(label, "-> no payload:", note); bad++; continue; }
  const r = await fetch(`https://www.google-analytics.com/debug/mp/collect?measurement_id=${measurementId}&api_secret=placeholder`, { method: "POST", body: JSON.stringify({ ...payload, validation_behavior: "ENFORCE_RECOMMENDATIONS" }) });
  const j = await r.json();
  const msgs = j.validationMessages ?? [];
  console.log(label, "-> HTTP", r.status, msgs.length ? JSON.stringify(msgs) : "no validation messages");
  if (msgs.length) bad++;
}
console.log(bad ? `${bad} payload(s) failed validation` : "all payloads accepted by the validation server");
process.exit(bad ? 1 : 0);
