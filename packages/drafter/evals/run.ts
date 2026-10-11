// Live eval against the real model. Writes evals/results/<date>.json and prints a table.
//   node evals/run.ts [--model anthropic/claude-sonnet-5.5] [--only 3,5]
import fs from "node:fs";
import path from "node:path";
import { draftProject, describePhoto, openrouterJson, usage, DEFAULT_MODEL, ollamaJson, describePhotoLocal, LOCAL_MODEL, localUsage } from "../src/index.ts";
import { sampleContext } from "../src/fixtures.ts";
import { CASES } from "./cases.ts";

const argv = process.argv.slice(2);
const arg = (n: string) => { const i = argv.indexOf(n); return i > -1 ? argv[i + 1] : null; };
const backend = arg("--backend") ?? "ollama";
const model = arg("--model") ?? (backend === "ollama" ? LOCAL_MODEL : DEFAULT_MODEL);
const llm = backend === "ollama" ? ollamaJson : openrouterJson;
const describe = backend === "ollama" ? describePhotoLocal : describePhoto;
const only = arg("--only")?.split(",").map(Number);
const root = path.resolve(import.meta.dirname, "..", "..", "..");
const cacheFile = path.join(import.meta.dirname, `cache-vision-${arg("--backend") ?? "ollama"}.json`);
const vision: Record<string, string> = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, "utf8")) : {};
const ctx = sampleContext();
const results: unknown[] = [];

for (const [idx, c] of CASES.entries()) {
  if (only && !only.includes(idx + 1)) continue;
  const intake = structuredClone(c.intake);
  for (const p of intake.photos) {
    if (p.visibleDescription) continue;
    const file = path.join(root, "assets", "source", p.file);
    if (!vision[p.file]) { vision[p.file] = await describe(file); fs.writeFileSync(cacheFile, JSON.stringify(vision, null, 1)); }
    p.visibleDescription = vision[p.file];
  }
  const t0 = Date.now();
  const r = await draftProject(intake, ctx, { llm, model });
  const firstOk = r.history[0]?.ok === true;
  results.push({ case: idx + 1, name: c.name, kind: c.kind, note: c.note, status: r.status, attempts: r.attempts, firstAttemptClean: firstOk, firstErrors: r.history[0]?.errors ?? [], finalErrors: r.lastReport.errors, warnings: r.lastReport.warnings, seconds: +((Date.now() - t0) / 1000).toFixed(1), draft: r.draft });
  console.log(`${String(idx + 1).padStart(2)} ${r.status.padEnd(16)} attempts=${r.attempts} first=${firstOk ? "clean" : "dirty"}  ${c.name}`);
  for (const e of r.history[0]?.errors ?? []) console.log("     first attempt:", e.slice(0, 150));
}
const out = path.join(import.meta.dirname, "results", `${new Date().toISOString().slice(0, 10)}-${model.replace(/[^a-z0-9]+/gi, "_")}.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
const ready = (results as { status: string }[]).filter((x) => x.status === "ready_for_review").length;
const first = (results as { firstAttemptClean: boolean }[]).filter((x) => x.firstAttemptClean).length;
const summary = { model, cases: results.length, readyForReview: ready, firstAttemptClean: first, backend, calls: backend === "ollama" ? localUsage.calls : usage.calls, modelSeconds: +localUsage.seconds.toFixed(1), promptTokens: usage.prompt, completionTokens: usage.completion };
fs.writeFileSync(out, JSON.stringify({ summary, results }, null, 1));
console.log(JSON.stringify(summary));
console.log("saved", out);
