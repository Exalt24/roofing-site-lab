// CallRail never resends a failed webhook. A nightly reconcile asks the calls API for everything since the last run and inserts whatever the ledger is missing.
import { parseCall } from "./callrail.ts";
import type { Ledger } from "./ledger.ts";

export interface ReconcileReport { checked: number; missing: number; insertedIds: number[]; skippedBadPayloads: number }

export async function reconcileCalls(ledger: Ledger, fetchCalls: (sinceIso: string) => Promise<Record<string, unknown>[]>, sinceIso: string, now = new Date()): Promise<ReconcileReport> {
  const calls = await fetchCalls(sinceIso);
  const rep: ReconcileReport = { checked: calls.length, missing: 0, insertedIds: [], skippedBadPayloads: 0 };
  for (const c of calls) {
    let ev;
    try { ev = parseCall(c); } catch { rep.skippedBadPayloads++; continue; }
    const r = ledger.insert(ev, now);
    if (r.inserted) { rep.missing++; rep.insertedIds.push(r.id); }
  }
  return rep;
}
