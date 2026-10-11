// CallRail webhook handling, written against CallRail's documented behaviour (apidocs.callrail.com, fetched 2026-10-11):
//  - a `Signature` header holds base64(HMAC-SHA1(raw body, company signing key));
//  - CallRail does NOT resend a failed webhook, so every event is stored first and reconciled against the calls API later;
//  - the form-submission webhook has no gclid key, so click ids are parsed out of landing_page_url;
//  - customer_phone_number is E.164.
import { createHmac, timingSafeEqual } from "node:crypto";

export function sign(body: string | Buffer, key: string): string {
  return createHmac("sha1", key).update(body).digest("base64");
}

export function verifySignature(body: string | Buffer, header: string | null | undefined, key: string): boolean {
  if (!header) return false;
  const want = Buffer.from(sign(body, key));
  const got = Buffer.from(header.trim());
  return want.length === got.length && timingSafeEqual(want, got);
}

export interface ClickIds { gclid?: string; wbraid?: string; gbraid?: string; msclkid?: string; utm_source?: string; utm_medium?: string; utm_campaign?: string }

export function clickIds(url: string | null | undefined): ClickIds {
  if (!url) return {};
  try {
    const q = new URL(url, "https://x.invalid").searchParams;
    const out: ClickIds = {};
    for (const k of ["gclid", "wbraid", "gbraid", "msclkid", "utm_source", "utm_medium", "utm_campaign"] as const) { const v = q.get(k); if (v) out[k] = v; }
    return out;
  } catch { return {}; }
}

/** A GA cookie value looks like GA1.1.123456789.1700000000; Google wants the client id without the GA1.1 prefix, which is what the site form sends. */
export function gaClientIdFrom(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const m = /^GA\d\.\d\.(\d+\.\d+)$/.exec(raw.trim());
  return m ? m[1] : raw.trim() || undefined;
}

export function toE164(raw: string | null | undefined, defaultCountry = "1"): string | null {
  if (!raw) return null;
  // an extension ("ext. 12", "x12", "#12") is not part of the number: cut it off before reading digits, or "...0142 ext. 1234" becomes a bogus 15 digit number
  if (raw.length > 64) return null; // no phone number is this long, and a very long run of spaces would make the pattern below take seconds
  const main = raw.split(/\s{0,5}(?:ext\.?|extension|x|#)\s{0,5}\d+\s{0,5}$/i)[0];
  const d = main.replace(/[^\d+]/g, "");
  // North American numbers (+1) must be a real shape: ten digits, area code and exchange not starting with 0 or 1; anything else would be hashed and uploaded as a number nobody owns
  const nanp = (e: string) => (e.startsWith("+1") ? /^\+1[2-9]\d{2}[2-9]\d{6}$/.test(e) : true);
  if (d.startsWith("+")) return /^\+[1-9]\d{7,14}$/.test(d) && nanp(d) ? d : null; // a country code never starts with 0
  const digits = d.replace(/\D/g, "");
  if (digits.length === 10) { const e = `+${defaultCountry}${digits}`; return nanp(e) ? e : null; }
  if (digits.length === 11 && digits.startsWith(defaultCountry)) { const e = `+${digits}`; return nanp(e) ? e : null; }
  return null;
}

export interface LeadEvent {
  kind: "call" | "form";
  sourceEventId: string;
  occurredAt: string; // ISO
  phoneE164: string | null;
  email: string | null;
  name: string | null;
  landingPageUrl: string | null;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  utm: { source?: string; medium?: string; campaign?: string };
  gclid?: string; wbraid?: string; gbraid?: string; msclkid?: string;
  consentVersion?: string; marketingOptIn?: boolean; measurementOptIn?: boolean; clickAt?: string; // set for the site's own quote form only (clickAt: when the visitor first arrived from an ad)
  gaClientId?: string;
  firstTime: boolean | null;
  trackingNumber: string | null;
  raw: unknown;
}

type Json = Record<string, any>;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export function parseCall(p: Json): LeadEvent {
  // resource_id is the alphanumeric CAL... id the API lists the call under (CallRail replaced the numeric webhook id with it), so it wins when both are present; a numeric id is the fallback
  const id = str(p.resource_id) ?? str(p.id) ?? str(p.call_id) ?? (typeof p.id === "number" ? String(p.id) : null);
  if (!id) throw new Error("call payload has no id");
  const ids = clickIds(str(p.landing_page_url) ?? str(p.last_requested_url));
  return {
    kind: "call", sourceEventId: id, occurredAt: str(p.start_time) ?? new Date().toISOString(),
    phoneE164: toE164(str(p.customer_phone_number)), email: null, name: str(p.customer_name),
    landingPageUrl: str(p.landing_page_url), source: str(p.source), medium: str(p.medium), campaign: str(p.campaign),
    utm: { source: str(p.utm_source) ?? ids.utm_source, medium: str(p.utm_medium) ?? ids.utm_medium, campaign: str(p.utm_campaign) ?? ids.utm_campaign },
    gclid: str(p.gclid) ?? ids.gclid, wbraid: ids.wbraid, gbraid: ids.gbraid, msclkid: str(p.msclkid) ?? ids.msclkid,
    gaClientId: gaClientIdFrom(str(p.custom?._ga)), // Custom Cookie Capture puts cookie values in `custom`
    firstTime: typeof p.first_call === "boolean" ? p.first_call : null, trackingNumber: str(p.tracking_phone_number), raw: p,
  };
}

export function parseForm(p: Json): LeadEvent {
  const id = str(p.id) ?? (typeof p.id === "number" ? String(p.id) : null);
  if (!id) throw new Error("form payload has no id");
  const fd: Json = p.form_data ?? {};
  const ids = clickIds(str(p.landing_page_url)); // the form webhook has no gclid key
  return {
    kind: "form", sourceEventId: id, occurredAt: str(p.submitted_at) ?? new Date().toISOString(),
    phoneE164: toE164(str(fd.phone) ?? str(fd.Phone) ?? str(fd.phone_number)), email: str(fd.email) ?? str(fd.Email), name: str(fd.name) ?? str(fd.Name),
    landingPageUrl: str(p.landing_page_url), source: str(p.source), medium: str(p.medium), campaign: str(p.campaign),
    utm: { source: str(p.utm_source) ?? ids.utm_source, medium: str(p.utm_medium) ?? ids.utm_medium, campaign: str(p.utm_campaign) ?? ids.utm_campaign },
    gclid: ids.gclid, wbraid: ids.wbraid, gbraid: ids.gbraid, msclkid: ids.msclkid,
    firstTime: typeof p.first_form === "boolean" ? p.first_form : null, trackingNumber: null, raw: p,
  };
}
