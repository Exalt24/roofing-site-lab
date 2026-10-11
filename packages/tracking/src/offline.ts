// Closing the loop: a lead that becomes an estimate and then a sold job is sent back to GA4 (Measurement Protocol) and to Google Ads through the Data Manager API.
// New offline-conversion work cannot use the Google Ads API UploadClickConversions route any more (restricted from 2026-06-15, developers.google.com/google-ads/api/docs/deprecations),
// so the Ads builder below produces a Data Manager IngestEvents request body. Both builders are pure so they can be tested; neither can send anything on its own.
import { sha256, normaliseEmail, type LeadRow } from "./ledger.ts";

export { normaliseEmail };

const HOURS = 3600 * 1000;
const DAY = 24 * HOURS;

export type Ga4Stage = "generate_lead" | "qualify_lead" | "close_convert_lead";

export interface Ga4Payload { client_id: string; timestamp_micros?: number; events: { name: Ga4Stage; params: Record<string, string | number> }[] }

/** GA4 accepts events backdated by at most 72 hours. A sold job usually closes weeks later, so the timestamp is omitted (GA4 stamps it "now") and the note says so.
 *  Session attribution needs a session_id in the params and a request sent within 24 hours of the session start (developers.google.com/analytics/devguides/collection/protocol/ga4/use-cases),
 *  so a weeks-late sold job is not attributed to its session in GA4; it is attributed in Google Ads through the Data Manager upload. Pass sessionId when the lead was captured with one. */
export function ga4Payload(lead: LeadRow, stage: Ga4Stage, opts: { value?: number; currency?: string; at?: Date; now?: Date; sessionId?: string | number } = {}): { payload: Ga4Payload | null; note: string } {
  if (lead.kind === "form" && !lead.measurement_opt_in) return { payload: null, note: "the person did not tick the measurement box on the form, so nothing is sent to Google" };
  if (!lead.ga_client_id) return { payload: null, note: "no GA client id was captured for this lead, so GA4 cannot attribute it; use the Google Ads route instead" };
  const now = opts.now ?? new Date();
  const at = opts.at ?? now;
  const ageHours = (now.getTime() - at.getTime()) / HOURS;
  const params: Record<string, string | number> = { transaction_id: `lead-${lead.id}-${stage}`, engagement_time_msec: 1 };
  if (opts.value !== undefined) { params.value = opts.value; params.currency = opts.currency ?? "CAD"; } // value and currency travel together or not at all
  const src = lead.utm_source ?? lead.source;
  if (src && stage === "generate_lead") params.lead_source = src; // documented for generate_lead only
  // session_id is a positive integer in the documented format; anything else is left out rather than sent as the wrong type
  if (opts.sessionId !== undefined && ageHours <= 24 && /^\d+$/.test(String(opts.sessionId))) params.session_id = Number(opts.sessionId);
  const p: Ga4Payload = { client_id: lead.ga_client_id, events: [{ name: stage, params }] };
  let note = "ok";
  if (ageHours <= 72 && ageHours >= 0) p.timestamp_micros = at.getTime() * 1000; // Google wants a time between 72 hours ago and now
  else note = `the event is ${Math.round(ageHours)} hours from now and GA4 only accepts up to 72 hours back, so it is sent without a timestamp`;
  return { payload: p, note };
}

function vancouverOffset(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver", timeZoneName: "longOffset" }).formatToParts(d);
  const tz = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-08:00";
  return tz.replace("GMT", "") || "+00:00";
}
/** ISO 8601 with an offset, the Data Manager timestamp format, in Vancouver time. */
function adsTime(d: Date): string {
  const f = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Vancouver", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(d);
  return `${f.replace(" ", "T")}${vancouverOffset(d)}`;
}

export interface DataManagerDestination { operatingAccountId: string; loginAccountId?: string; conversionActionId: string }
export interface IngestEvent {
  adIdentifiers?: { gclid?: string; gbraid?: string; wbraid?: string };
  conversionValue: number; currency: string; eventTimestamp: string; transactionId: string; eventSource: "WEB" | "PHONE"; // the reference lists WEB, APP, IN_STORE, PHONE, MESSAGE, OTHER (the send-events guide says CALL, which the reference does not have)
  userData?: { userIdentifiers: ({ emailAddress: string } | { phoneNumber: string })[] };
}
export interface IngestEventsRequest {
  destinations: { operatingAccount: { accountType: "GOOGLE_ADS"; accountId: string }; loginAccount: { accountType: "GOOGLE_ADS"; accountId: string }; productDestinationId: string }[];
  encoding: "HEX"; consent: { adUserData: "CONSENT_GRANTED" | "CONSENT_DENIED"; adPersonalization: "CONSENT_GRANTED" | "CONSENT_DENIED" };
  events: IngestEvent[]; validateOnly: boolean;
}

/** A click id is kept 90 days. A conversion matched on personal data (enhanced conversions for leads) is only imported within 63 days of the click (support.google.com/google-ads/answer/15081888).
 *  The limit is on the day of the UPLOAD, so the age is measured from the click to the upload (default: now), never to the conversion time written on the event. */
export const CLICK_ID_DAYS = 90;
export const USER_DATA_DAYS = 63;
export const clickAgeDays = (lead: LeadRow, uploadAt = new Date()) => (uploadAt.getTime() - new Date(lead.click_at ?? lead.occurred_at).getTime()) / DAY;

export type OfflineStage = "estimate" | "sold";

/**
 * One lead and one outcome (estimate booked, job sold) as a Data Manager event. Returns null with a reason when there is nothing to attribute to, the click has aged out, or the dates make no sense.
 * Only one click id is sent, in the order gclid, gbraid, wbraid. The API is fast-fail (one bad event rejects the whole request), so send with validateOnly first.
 * transactionId is per lead and stage, so a revised value updates the same conversion and an estimate and a sold job never collide.
 */
export function adsIngestEvent(lead: LeadRow, opts: { stage: OfflineStage; value: number; currency?: string; at?: Date; uploadAt?: Date; email?: string | null }): { event: IngestEvent | null; note: string } {
  if (lead.kind === "form" && !lead.measurement_opt_in) return { event: null, note: "the person did not tick the measurement box on the form, so nothing is sent to Google" };
  const at = opts.at ?? new Date();
  const uploadAt = opts.uploadAt ?? new Date();
  const click = new Date(lead.click_at ?? lead.occurred_at).getTime();
  if (Number.isNaN(click)) return { event: null, note: "the stored click time is not a valid date, so the click age cannot be checked" };
  if (Number.isNaN(at.getTime()) || Number.isNaN(uploadAt.getTime())) return { event: null, note: "the conversion or upload time is not a valid date" };
  if (!Number.isFinite(opts.value) || opts.value < 0) return { event: null, note: "the value must be a number of zero or more" };
  if (at.getTime() < click) return { event: null, note: "the conversion is dated before the click, which Google rejects" };
  const age = clickAgeDays(lead, uploadAt);
  if (age < 0) return { event: null, note: "the upload time is before the click" };
  const hasClickId = !!(lead.gclid || lead.gbraid || lead.wbraid);
  const identifiers: ({ emailAddress: string } | { phoneNumber: string })[] = [];
  if (opts.email) identifiers.push({ emailAddress: sha256(normaliseEmail(opts.email)) });
  if (lead.phone_e164) identifiers.push({ phoneNumber: sha256(lead.phone_e164) });
  if (!hasClickId && !identifiers.length) return { event: null, note: "no click id and no phone or email, so there is nothing to attribute to" };
  const event: IngestEvent = {
    conversionValue: opts.value, currency: opts.currency ?? "CAD", eventTimestamp: adsTime(at),
    transactionId: `lead-${lead.id}-${opts.stage}`, eventSource: lead.kind === "call" ? "PHONE" : "WEB",
  };
  const days = Math.floor(age);
  // a call carries no click time, so its age is counted from the call; the real click can be older, and Google also drops a click older than the conversion action's click-through window (30 days unless set otherwise)
  const caveat = lead.kind === "call" && !lead.click_at ? "; counted from the call time, so the click may be older" : "";
  if (hasClickId && age <= CLICK_ID_DAYS) {
    event.adIdentifiers = lead.gclid ? { gclid: lead.gclid } : lead.gbraid ? { gbraid: lead.gbraid } : { wbraid: lead.wbraid! };
    if (identifiers.length && age <= USER_DATA_DAYS) event.userData = { userIdentifiers: identifiers };
    return { event, note: identifiers.length && age > USER_DATA_DAYS ? `the click is ${days} days old at upload: sent with the click id only, because matching on phone and email stops at ${USER_DATA_DAYS} days${caveat}` : `ok${caveat}` };
  }
  if (identifiers.length && age <= USER_DATA_DAYS) {
    event.userData = { userIdentifiers: identifiers };
    return { event, note: hasClickId ? `the click id is ${days} days old at upload (kept ${CLICK_ID_DAYS}), matching on phone and email instead` : "no click id, matching on phone and email" };
  }
  return { event: null, note: `the click is ${days} days old at upload: the click id is past ${CLICK_ID_DAYS} days and matching on phone and email is past ${USER_DATA_DAYS} days, so this conversion cannot be imported` };
}

/** The IngestionService request body. validateOnly defaults to true: Google checks everything and processes nothing until it is set to false.
 *  Consent has no default: the caller states whether the person agreed to their hashed details being used for ad measurement, and the privacy page must say so. */
export function adsIngestRequest(dest: DataManagerDestination, events: IngestEvent[], opts: { consent: boolean; validateOnly?: boolean }): IngestEventsRequest {
  const consent = opts.consent ? "CONSENT_GRANTED" : "CONSENT_DENIED";
  const account = (id: string) => ({ accountType: "GOOGLE_ADS" as const, accountId: id.replace(/-/g, "") }); // Google wants the 10 digit customer id without hyphens
  return {
    destinations: [{ operatingAccount: account(dest.operatingAccountId), loginAccount: account(dest.loginAccountId ?? dest.operatingAccountId), productDestinationId: dest.conversionActionId }],
    encoding: "HEX", consent: { adUserData: consent, adPersonalization: consent }, events, validateOnly: opts.validateOnly ?? true,
  };
}

/** Data Manager accepts at most 2,000 events per IngestEvents request, and a fast-fail API rejects the whole request for one bad event, so a long list goes up in chunks. */
export const MAX_EVENTS_PER_REQUEST = 2000;
export function adsIngestRequests(dest: DataManagerDestination, events: IngestEvent[], opts: { consent: boolean; validateOnly?: boolean }): IngestEventsRequest[] {
  const out: IngestEventsRequest[] = [];
  for (let i = 0; i < events.length; i += MAX_EVENTS_PER_REQUEST) out.push(adsIngestRequest(dest, events.slice(i, i + MAX_EVENTS_PER_REQUEST), opts));
  return out.length ? out : [adsIngestRequest(dest, [], opts)];
}

/** Leads still waiting on an outcome whose click is close to the limits: worth a warning while a conversion can still be imported. */
export function leadsNearingClickExpiry(leads: LeadRow[], now = new Date(), warnAtDays = USER_DATA_DAYS - 7): LeadRow[] {
  return leads.filter((l) => {
    const age = clickAgeDays(l, now);
    return (l.stage === "new" || l.stage === "estimate") && age >= warnAtDays && age <= CLICK_ID_DAYS;
  });
}
