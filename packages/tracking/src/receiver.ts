// HTTP receiver: CallRail webhooks and the site's own quote form. Rule one: the event is stored before it is acknowledged or emailed.
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { clickIds, parseCall, parseForm, toE164, verifySignature, type LeadEvent } from "./callrail.ts";
import type { Ledger } from "./ledger.ts";

export interface ReceiverOptions {
  ledger: Ledger;
  signingKey: string;
  ownerEmail: string;
  turnstileVerify?: (token: string, ip: string) => Promise<boolean>; // when set, a valid token is required
  now?: () => Date;
  replayWindowSeconds?: number; // reject a webhook whose own timestamp is older than this
  rateLimit?: { max: number; windowSeconds: number };
  allowOrigin?: string; // no CORS header at all unless this is set
  maxBodyBytes?: number;
  trustProxyHeader?: boolean; // only true when the receiver sits behind a proxy that overwrites X-Forwarded-For / CF-Connecting-IP; otherwise a caller can invent a new address per request and walk past the rate limit
}

const json = (res: ServerResponse, status: number, body: unknown, origin?: string) => {
  res.writeHead(status, { "Content-Type": "application/json", ...(origin ? { "Access-Control-Allow-Origin": origin } : {}) });
  res.end(JSON.stringify(body));
};

async function readBody(req: IncomingMessage, max: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > max) throw Object.assign(new Error("body too large"), { status: 413 });
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}

/** One line, no control characters, capped: a name or address ends up in an email subject and a ledger row, so a pasted line break must not become a second header. */
export const cleanLine = (v: string, max: number) => v.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ").trim().slice(0, max);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createReceiver(o: ReceiverOptions): Server {
  if (!o.signingKey) throw new Error("signingKey is empty: an empty key would accept any webhook signed with the empty string");
  const now = o.now ?? (() => new Date());
  const max = o.maxBodyBytes ?? 256 * 1024;
  const hits = new Map<string, number[]>();
  const limited = (ip: string): boolean => {
    if (!o.rateLimit) return false;
    const t = now().getTime();
    const recent = (hits.get(ip) ?? []).filter((x) => t - x < o.rateLimit!.windowSeconds * 1000);
    recent.push(t);
    hits.set(ip, recent);
    if (hits.size > 5000) for (const [k, v] of hits) if (t - v[v.length - 1] >= o.rateLimit.windowSeconds * 1000) hits.delete(k); // addresses that went quiet are forgotten, so the map cannot grow without bound
    return recent.length > o.rateLimit.max;
  };

  return createServer(async (req, res) => {
    let url: URL;
    try { url = new URL(req.url ?? "/", "http://x"); } catch { return json(res, 400, { error: "bad request target" }); } // a malformed target such as "//:" must be a 400, never an unhandled rejection that ends the process
    const ip = o.trustProxyHeader
      ? String(req.headers["cf-connecting-ip"] ?? req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0].trim()
      : String(req.socket.remoteAddress ?? "");
    try {
      if (req.method === "OPTIONS") { res.writeHead(204, { ...(o.allowOrigin ? { "Access-Control-Allow-Origin": o.allowOrigin } : {}), "Access-Control-Allow-Headers": "Content-Type" }); return res.end(); }
      if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true, leads: o.ledger.count(), pendingEmails: o.ledger.pending() });

      if (req.method === "POST" && (url.pathname === "/callrail/post-call" || url.pathname === "/callrail/form")) {
        const raw = await readBody(req, max);
        if (!verifySignature(raw, req.headers["signature"] as string | undefined, o.signingKey)) return json(res, 401, { error: "bad signature" });
        let payload: Record<string, any>;
        try { payload = JSON.parse(raw.toString("utf8")); } catch { return json(res, 400, { error: "not json" }); }
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) return json(res, 400, { error: "expected a JSON object" });
        if (o.replayWindowSeconds) {
          // with a replay window set, a webhook must carry a readable timestamp inside it; a missing or unreadable one cannot be shown to be fresh
          const age = (now().getTime() - new Date(payload.timestamp ?? payload.start_time ?? payload.submitted_at ?? "").getTime()) / 1000;
          if (!Number.isFinite(age)) return json(res, 400, { error: "webhook has no readable timestamp" });
          if (age > o.replayWindowSeconds) return json(res, 409, { error: "stale webhook" });
        }
        let ev: LeadEvent;
        try { ev = url.pathname.endsWith("form") ? parseForm(payload) : parseCall(payload); } catch (e) { return json(res, 400, { error: (e as Error).message }); }
        const r = o.ledger.insert(ev, now()); // stored FIRST, then acknowledged quickly
        return json(res, 200, { ok: true, inserted: r.inserted, id: r.id });
      }

      if (req.method === "POST" && url.pathname === "/api/lead") {
        const origin = o.allowOrigin;
        if (limited(ip)) return json(res, 429, { error: "too many requests, please call us instead" }, origin);
        const ctype = String(req.headers["content-type"] ?? "");
        if (!/^(application\/x-www-form-urlencoded|multipart\/form-data)/i.test(ctype)) return json(res, 415, { error: "send the form as a normal form post" }, origin);
        const raw = await readBody(req, max);
        const request = new Request("http://x/api/lead", { method: "POST", headers: { "content-type": String(req.headers["content-type"] ?? "") }, body: raw });
        let form: FormData;
        try { form = await request.formData(); } catch { return json(res, 400, { error: "could not read the form" }, origin); }
        const f = (k: string) => String(form.get(k) ?? "").trim();
        const line = (k: string, n: number) => cleanLine(f(k), n);
        if (f("website")) return json(res, 200, { ok: true }, origin); // honeypot: bots get a success and nothing is stored
        if (o.turnstileVerify && !(await o.turnstileVerify(f("cf-turnstile-response"), ip))) return json(res, 400, { error: "spam check failed" }, origin);
        const name = line("name", 100); const message = f("message"); const email = line("email", 254);
        const phone = toE164(f("phone"));
        if (name.length < 2) return json(res, 400, { error: "please enter your name" }, origin);
        if (!phone) return json(res, 400, { error: "please enter a phone number we can call" }, origin);
        if (!message || message.length > 2000) return json(res, 400, { error: "please tell us what is going on with the roof (up to 2000 characters)" }, origin);
        if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(res, 400, { error: "that email address does not look right" }, origin);
        // The ad-measurement details (landing page, campaign, ad click id, click time, Google Analytics visitor id) are kept only when the visitor ticked the separate, unticked-by-default measurement box.
        // Without it the lead is stored with what they typed and nothing else, and it can never reach the Google conversion uploads.
        const measure = f("measurement_opt_in") === "yes";
        const landing = measure ? line("landing_page", 500) : "";
        // when the visitor first arrived from an ad, as the page recorded it; only a believable time (not in the future, within the 90 days a click id lives) is kept
        const clickMs = measure ? Date.parse(line("click_time", 40)) : NaN;
        const nowMs = now().getTime();
        const clickAt = Number.isFinite(clickMs) && clickMs <= nowMs + 60_000 && nowMs - clickMs <= 90 * 86_400_000 ? new Date(clickMs).toISOString() : undefined;
        const ids = clickIds(landing);
        const m = (k: string, n: number) => (measure ? line(k, n) : "");
        const ev: LeadEvent = {
          kind: "form", sourceEventId: `site-${UUID.test(f("submission_id")) ? f("submission_id").toLowerCase() : o.ledger.newSubmissionId()}`, occurredAt: now().toISOString(), phoneE164: phone, email: email || null, name,
          landingPageUrl: landing || null, source: ids.utm_source ?? null, medium: ids.utm_medium ?? null, campaign: ids.utm_campaign ?? null,
          utm: { source: m("utm_source", 100) || ids.utm_source, medium: m("utm_medium", 100) || ids.utm_medium, campaign: m("utm_campaign", 200) || ids.utm_campaign },
          gclid: m("gclid", 200) || ids.gclid, wbraid: m("wbraid", 200) || ids.wbraid, gbraid: m("gbraid", 200) || ids.gbraid, gaClientId: m("ga_client_id", 60) || undefined,
          firstTime: null, trackingNumber: null, raw: { form: "quote", landing_page: landing, service: line("service", 80) || null, area: line("area", 80) || null },
          consentVersion: line("consent_text_version", 40) || "none", marketingOptIn: f("marketing_opt_in") === "yes", measurementOptIn: measure, clickAt,
        };
        const r = o.ledger.insert(ev, now());
        if (r.inserted) o.ledger.enqueue(r.id, "email", { to: o.ownerEmail, subject: `New quote request from ${name}`, text: `${name}\n${phone}\n${email}\n\n${message}${landing ? `\n\nPage: ${landing}` : ""}` }, now());
        return json(res, 200, { ok: true }, origin);
      }
      return json(res, 404, { error: "not found" });
    } catch (e) {
      const status = (e as { status?: number }).status ?? 500;
      return json(res, status, { error: status === 413 ? "too large" : "server error" });
    }
  });
}

export async function drainOutbox(ledger: Ledger, send: (payload: { to: string; subject: string; text: string }) => Promise<void>, now = new Date()) {
  const out = { sent: 0, failed: 0 };
  for (const row of ledger.due(now)) {
    if (!ledger.claim(row.id, now)) continue; // another drain already has this row
    try { await send(JSON.parse(row.payload)); ledger.markSent(row.id, now); out.sent++; }
    catch (e) { ledger.markFailed(row.id, (e as Error).message, now); out.failed++; }
  }
  return out;
}
