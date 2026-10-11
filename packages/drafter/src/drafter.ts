// Draft a project write-up, validate it in code, retry with the validator's findings, and refuse to call a failing draft ready.
import { createHash } from "node:crypto";
import { DRAFT_JSON_SCHEMA, PROMPT_VERSION } from "./schema.ts";
import { SYSTEM, userMessage } from "./prompt.ts";
import { validateDraft, inputPrivacyProblems } from "./validators.ts";
import { buildFacts, missingSlots } from "./facts.ts";
import type { Context, Draft, Intake, LlmFn, Report } from "./types.ts";

export interface RunResult {
  idempotencyKey: string;
  status: "ready_for_review" | "needs_human";
  attempts: number;
  draft: Draft | null;
  lastReport: Report;
  history: { attempt: number; ok: boolean; errors: string[]; warnings: string[] }[];
  missingInformation: string[];
  model: string;
  promptVersion: string;
  inputHash: string;
}

// Which details are missing is a fact about the intake, so code computes it and merges it in; the model may add more but is never trusted to find them.
export function withMissingInformation(out: unknown, i: Intake): unknown {
  const d = out as Partial<Draft> | null;
  if (!d || typeof d !== "object" || !Array.isArray(d.missingInformation)) return out;
  const have = d.missingInformation.map((x) => String(x).toLowerCase()).join(" | ");
  const add = missingSlots(i).filter((label) => !have.includes(label.toLowerCase().split(" ").slice(0, 2).join(" ")));
  return { ...d, missingInformation: [...d.missingInformation, ...add] };
}

export function inputHash(i: Intake, ctx: Context): string {
  return createHash("sha256").update(JSON.stringify({ i: { ...i, private: undefined }, f: buildFacts(i, ctx) })).digest("hex").slice(0, 16);
}

export async function draftProject(i: Intake, ctx: Context, opts: { llm: LlmFn; model: string; maxAttempts?: number }): Promise<RunResult> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const ih = inputHash(i, ctx);
  const leaks = inputPrivacyProblems(i);
  if (leaks.length) {
    // refused before any model call: what an employee typed would otherwise be sent to the model
    const report: Report = { ok: false, errors: leaks.map((l) => `intake refused: ${l}`), warnings: [] };
    return { idempotencyKey: createHash("sha256").update([i.jobId, ih, PROMPT_VERSION, opts.model].join("|")).digest("hex").slice(0, 24), status: "needs_human", attempts: 0, draft: null, lastReport: report, history: [], missingInformation: missingSlots(i), model: opts.model, promptVersion: PROMPT_VERSION, inputHash: ih };
  }
  const history: RunResult["history"] = [];
  let errs: string[] = [];
  let last: Report = { ok: false, errors: ["no attempt made"], warnings: [] };
  let draft: Draft | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let out: unknown;
    try {
      out = await opts.llm({ system: SYSTEM, user: userMessage(i, ctx, errs), schema: DRAFT_JSON_SCHEMA, model: opts.model });
    } catch (e) {
      last = { ok: false, errors: [`model call failed: ${(e as Error).message}`], warnings: [] };
      history.push({ attempt, ...last });
      errs = last.errors;
      continue;
    }
    try {
      out = withMissingInformation(out, i);
      last = validateDraft(out, i, ctx);
    } catch (e) {
      // a model that returns something the validators cannot even read is a failed attempt to retry, never a crash
      last = { ok: false, errors: [`the draft could not be validated: ${(e as Error).message}`], warnings: [] };
      history.push({ attempt, ...last });
      errs = last.errors;
      continue;
    }
    history.push({ attempt, ok: last.ok, errors: last.errors, warnings: last.warnings });
    if (last.ok) { draft = out as Draft; break; }
    errs = last.errors;
    draft = out as Draft; // kept so a person can still read the best effort, but it is never marked ready
  }
  const ok = history.at(-1)?.ok === true;
  return {
    idempotencyKey: createHash("sha256").update([i.jobId, ih, PROMPT_VERSION, opts.model].join("|")).digest("hex").slice(0, 24),
    status: ok ? "ready_for_review" : "needs_human",
    attempts: history.length,
    draft,
    lastReport: last,
    history,
    missingInformation: missingSlots(i),
    model: opts.model,
    promptVersion: PROMPT_VERSION,
    inputHash: ih,
  };
}
