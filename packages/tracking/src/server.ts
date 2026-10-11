// A runnable receiver: reads its settings from the environment, starts the HTTP receiver, drains the outbox every minute, purges expired leads daily and,
// when CallRail API settings are present, reconciles missed webhooks nightly.
//   node --experimental-sqlite src/server.ts
// Required: CALLRAIL_SIGNING_KEY, OWNER_EMAIL. Optional: PORT (8787), LEDGER_PATH (./ledger.sqlite), ALLOW_ORIGIN, TRUST_PROXY=1 (only behind a proxy that overwrites the client address),
// RETENTION_MONTHS (24), NOTIFY_WEBHOOK_URL (each new lead is POSTed there as JSON; with none, messages wait in the outbox), CALLRAIL_API_KEY and CALLRAIL_ACCOUNT_ID (nightly reconcile).
// The reconcile request follows CallRail's published API reference; it has not been run against a live account.
import type { Server } from "node:http";
import { Ledger } from "./ledger.ts";
import { createReceiver, drainOutbox } from "./receiver.ts";
import { reconcileCalls } from "./reconcile.ts";

export interface Running { server: Server; ledger: Ledger; stop: () => Promise<void> }

export async function startServer(env: Record<string, string | undefined>, log: (m: string) => void = console.log): Promise<Running> {
  const signingKey = env.CALLRAIL_SIGNING_KEY ?? "";
  const ownerEmail = env.OWNER_EMAIL ?? "";
  if (!signingKey || !ownerEmail) throw new Error("CALLRAIL_SIGNING_KEY and OWNER_EMAIL are required");
  const retention = Number(env.RETENTION_MONTHS ?? 24);
  if (!Number.isFinite(retention) || retention < 1) throw new Error("RETENTION_MONTHS must be a number of months, 1 or more");
  const ledger = new Ledger(env.LEDGER_PATH ?? "./ledger.sqlite");
  const server = createReceiver({
    ledger, signingKey, ownerEmail, allowOrigin: env.ALLOW_ORIGIN, trustProxyHeader: env.TRUST_PROXY === "1",
    rateLimit: { max: 10, windowSeconds: 60 }, replayWindowSeconds: 24 * 3600,
  });
  await new Promise<void>((resolve) => server.listen(Number(env.PORT ?? 8787), resolve));

  const notify = env.NOTIFY_WEBHOOK_URL;
  const drain = async () => {
    if (!notify) return;
    const r = await drainOutbox(ledger, async (payload) => {
      const res = await fetch(notify, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error(`notify webhook answered ${res.status}`);
    });
    if (r.sent || r.failed) log(`outbox: ${r.sent} sent, ${r.failed} failed`);
  };
  const purge = () => { const r = ledger.purgeOlderThan(retention); if (r.leads) log(`retention: removed ${r.leads} leads older than ${retention} months`); };
  const reconcile = async () => {
    if (!env.CALLRAIL_API_KEY || !env.CALLRAIL_ACCOUNT_ID) return;
    const since = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const fetchCalls = async () => {
      const out: Record<string, unknown>[] = [];
      for (let page = 1; page <= 20; page++) {
        const url = `https://api.callrail.com/v3/a/${encodeURIComponent(env.CALLRAIL_ACCOUNT_ID!)}/calls.json?start_date=${since}&per_page=100&page=${page}&fields=landing_page_url,gclid,utm_source,utm_medium,utm_campaign,first_call,tracking_phone_number`;
        const res = await fetch(url, { headers: { Authorization: `Token token="${env.CALLRAIL_API_KEY}"` } });
        if (!res.ok) throw new Error(`CallRail answered ${res.status}`);
        const body = (await res.json()) as { calls?: Record<string, unknown>[] };
        out.push(...(body.calls ?? []));
        if ((body.calls ?? []).length < 100) break;
      }
      return out;
    };
    const rep = await reconcileCalls(ledger, fetchCalls, since);
    log(`reconcile: checked ${rep.checked}, filled ${rep.missing}`);
  };

  const timers = [
    setInterval(() => drain().catch((e) => log(`outbox error: ${(e as Error).message}`)), 60_000),
    setInterval(purge, 24 * 3600 * 1000),
    setInterval(() => reconcile().catch((e) => log(`reconcile error: ${(e as Error).message}`)), 24 * 3600 * 1000),
  ];
  for (const t of timers) t.unref();
  purge();
  return { server, ledger, stop: () => new Promise<void>((resolve) => { for (const t of timers) clearInterval(t); server.closeAllConnections(); server.close(() => resolve()); }) };
}

if (process.argv[1]?.endsWith("server.ts")) {
  startServer(process.env).then((r) => console.log(`receiver listening on ${(r.server.address() as { port: number }).port}`)).catch((e) => { console.error((e as Error).message); process.exit(1); });
}
