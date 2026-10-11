// A runnable receiver: reads its settings from the environment, starts the HTTP receiver, drains the outbox every minute, purges expired leads daily and,
// when CallRail API settings are present, reconciles missed webhooks at start-up and then nightly.
//   node --experimental-sqlite src/server.ts
// Required: CALLRAIL_SIGNING_KEY, OWNER_EMAIL. Optional: PORT (8787), LEDGER_PATH (./ledger.sqlite), ALLOW_ORIGIN, TRUST_PROXY=1 (behind a plain reverse proxy: the last X-Forwarded-For entry is the client) or TRUST_PROXY=cloudflare (behind Cloudflare: CF-Connecting-IP),
// RETENTION_MONTHS (24, whole months), TURNSTILE_SECRET (verifies the form's Turnstile token), NOTIFY_WEBHOOK_URL (each new lead is POSTed there as JSON; with none, messages wait in the outbox), CALLRAIL_API_KEY and CALLRAIL_ACCOUNT_ID (reconcile),
// RECONCILE_LOOKBACK_DAYS (3: CallRail does not resend, so a server that was down longer than this loses those calls).
// The reconcile request follows CallRail's published API reference; it has not been run against a live account, and it is not verified that a call's id in the webhook equals its id in the API.
import type { Server } from "node:http";
import { Ledger } from "./ledger.ts";
import { createReceiver, drainOutbox } from "./receiver.ts";
import { reconcileCalls } from "./reconcile.ts";

export interface Running { server: Server; ledger: Ledger; stop: () => Promise<void>; jobs: { drain: () => Promise<void>; purge: () => void; reconcile: () => Promise<void> } }
export interface Deps { fetch?: typeof fetch; now?: () => Date }

const MAX_PAGES = 20;
const PER_PAGE = 100;

export async function startServer(env: Record<string, string | undefined>, log: (m: string) => void = console.log, deps: Deps = {}): Promise<Running> {
  const doFetch = deps.fetch ?? fetch;
  const signingKey = env.CALLRAIL_SIGNING_KEY ?? "";
  const ownerEmail = env.OWNER_EMAIL ?? "";
  if (!signingKey || !ownerEmail) throw new Error("CALLRAIL_SIGNING_KEY and OWNER_EMAIL are required");
  const retention = Number(env.RETENTION_MONTHS ?? 24);
  if (!Number.isInteger(retention) || retention < 1) throw new Error("RETENTION_MONTHS must be a whole number of months, 1 or more");
  const lookback = Number(env.RECONCILE_LOOKBACK_DAYS ?? 3);
  if (!Number.isFinite(lookback) || lookback < 1) throw new Error("RECONCILE_LOOKBACK_DAYS must be 1 or more");
  const ledger = new Ledger(env.LEDGER_PATH ?? "./ledger.sqlite");
  const server = createReceiver({
    ledger, signingKey, ownerEmail, allowOrigin: env.ALLOW_ORIGIN, trustProxyHeader: env.TRUST_PROXY === "1", trustCloudflare: env.TRUST_PROXY === "cloudflare",
    rateLimit: { max: 10, windowSeconds: 60 }, replayWindowSeconds: 24 * 3600,
    // with TURNSTILE_SECRET set, the quote form needs a token Cloudflare accepts (the site renders the widget when PUBLIC_TURNSTILE_SITEKEY is set)
    turnstileVerify: env.TURNSTILE_SECRET ? async (token, ip) => {
      if (!token) return false;
      const res = await doFetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: new URLSearchParams({ secret: env.TURNSTILE_SECRET!, response: token, remoteip: ip }), signal: AbortSignal.timeout(10_000) });
      return res.ok && ((await res.json()) as { success?: boolean }).success === true;
    } : undefined,
  });
  await new Promise<void>((resolve) => server.listen(Number(env.PORT ?? 8787), resolve));

  const notify = env.NOTIFY_WEBHOOK_URL;
  const drain = async () => {
    if (!notify) return;
    const r = await drainOutbox(ledger, async (payload) => {
      const res = await doFetch(notify, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`notify webhook answered ${res.status}`);
    });
    if (r.sent || r.failed) log(`outbox: ${r.sent} sent, ${r.failed} failed`);
  };
  const purge = () => { const r = ledger.purgeOlderThan(retention, deps.now?.()); if (r.leads) log(`retention: removed ${r.leads} leads older than ${retention} months`); if (!r.scrubbed) log("retention: the log could not be emptied yet because another connection is reading; it is retried at the next purge"); };
  const reconcile = async () => {
    if (!env.CALLRAIL_API_KEY || !env.CALLRAIL_ACCOUNT_ID) return;
    const since = new Date((deps.now?.() ?? new Date()).getTime() - lookback * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const fetchCalls = async () => {
      const out: Record<string, unknown>[] = [];
      for (let page = 1; page <= MAX_PAGES; page++) {
        const url = `https://api.callrail.com/v3/a/${encodeURIComponent(env.CALLRAIL_ACCOUNT_ID!)}/calls.json?start_date=${since}&per_page=${PER_PAGE}&page=${page}&fields=landing_page_url,gclid,utm_source,utm_medium,utm_campaign,first_call,tracking_phone_number`;
        const res = await doFetch(url, { headers: { Authorization: `Token token="${env.CALLRAIL_API_KEY}"` }, signal: AbortSignal.timeout(20_000) });
        if (!res.ok) throw new Error(`CallRail answered ${res.status}`);
        const body = (await res.json()) as { calls?: Record<string, unknown>[] };
        out.push(...(body.calls ?? []));
        if ((body.calls ?? []).length < PER_PAGE) return out;
      }
      log(`reconcile: stopped after ${MAX_PAGES} pages (${out.length} calls); calls beyond that were not checked`);
      return out;
    };
    const rep = await reconcileCalls(ledger, fetchCalls, since);
    log(`reconcile: checked ${rep.checked}, filled ${rep.missing}`);
  };

  // every job catches its own errors: one failed fetch or a locked database must never end the process
  const safe = (name: string, f: () => unknown) => () => { try { Promise.resolve(f()).catch((e) => log(`${name} error: ${(e as Error).message}`)); } catch (e) { log(`${name} error: ${(e as Error).message}`); } };
  const timers = [
    setInterval(safe("outbox", drain), 60_000),
    setInterval(safe("retention", purge), 24 * 3600 * 1000),
    setInterval(safe("reconcile", reconcile), 24 * 3600 * 1000),
  ];
  for (const t of timers) t.unref();
  if (!env.NOTIFY_WEBHOOK_URL) log("NOTIFY_WEBHOOK_URL is not set: quote requests are stored but nobody is told; /health turns to 503 an hour after the first one");
  if (!env.ALLOW_ORIGIN) log("ALLOW_ORIGIN is not set: a quote form served from a different address than this receiver will store the lead but the visitor will see an error; set it to the site address");
  try { purge(); } catch (e) { log(`retention error: ${(e as Error).message}`); }
  safe("reconcile", reconcile)(); // at start-up too, so a server that restarts more often than daily still catches up
  return { server, ledger, jobs: { drain, purge, reconcile }, stop: () => new Promise<void>((resolve) => { for (const t of timers) clearInterval(t); server.closeAllConnections(); server.close(() => resolve()); }) };
}

if (process.argv[1]?.endsWith("server.ts")) {
  startServer(process.env).then((r) => console.log(`receiver listening on ${(r.server.address() as { port: number }).port}`)).catch((e) => { console.error((e as Error).message); process.exit(1); });
}
