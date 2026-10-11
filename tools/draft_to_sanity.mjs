// End to end: an employee's intake -> vision descriptions -> the draft step (local model) -> validators -> DRAFT documents in Sanity for a person to review and publish.
//   node tools/draft_to_sanity.mjs [case number 1-13, default 1]
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@sanity/client";
import { draftProject, describePhotoLocal, ollamaJson, LOCAL_MODEL, writeDrafts, cleanImageFile } from "../packages/drafter/src/index.ts";
import { sampleContext } from "../packages/drafter/src/fixtures.ts";
import { CASES } from "../packages/drafter/evals/cases.ts";
import { sanitySettings } from "./_env.mjs";

const root = path.resolve(import.meta.dirname, "..");
const n = Number(process.argv[2] ?? 1);
const intake = structuredClone(CASES[n - 1].intake);
const sn = sanitySettings();
const client = createClient({ projectId: sn.projectId, dataset: sn.dataset, apiVersion: "2025-02-19", token: sn.token, useCdn: false });
const assets = JSON.parse(fs.readFileSync(path.join(root, "assets", "sanity_assets.json"), "utf8"));

const refs = {};
for (const p of intake.photos) {
  p.visibleDescription = p.visibleDescription ?? (await describePhotoLocal(path.join(root, "assets", "source", p.file)));
  const key = `source/${p.file}`;
  if (!assets[key]) { const up = await client.assets.upload("image", await cleanImageFile(path.join(root, "assets", "source", p.file)), { filename: p.file }); assets[key] = up._id; fs.writeFileSync(path.join(root, "assets", "sanity_assets.json"), JSON.stringify(assets, null, 1)); }
  refs[p.id] = assets[key];
}
console.log("vision:", intake.photos.map((p) => p.visibleDescription));
const run = await draftProject(intake, sampleContext(), { llm: ollamaJson, model: LOCAL_MODEL });
console.log("status:", run.status, "attempts:", run.attempts, "idempotencyKey:", run.idempotencyKey);
if (run.lastReport.errors.length) console.log("errors:", run.lastReport.errors);
if (run.lastReport.warnings.length) console.log("warnings:", run.lastReport.warnings);
const ids = await writeDrafts(client, run, intake, refs);
console.log("written as drafts:", ids);
