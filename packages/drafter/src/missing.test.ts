import { test } from "node:test";
import assert from "node:assert/strict";
import { draftProject, withMissingInformation, type Draft, type LlmFn } from "./index.ts";
import { goodDraft, goodIntake, sampleContext } from "./fixtures.ts";

const ctx = sampleContext();

test("the pipeline computes the missing details in code, so a model that forgets to list them still passes honestly", async () => {
  const intake = structuredClone(goodIntake);
  intake.squareFeet = null; intake.colour = null; intake.durationDays = null;
  const draft: Draft = structuredClone(goodDraft);
  draft.seo.description = "How we replaced rotten deck boards, moved a bathroom fan outside and re-roofed a house in Caulfeild.";
  draft.sections[2].supportedBy = ["F11"]; // the ids shift when slots are blank; the solution entry is now one earlier
  const ids = (await draftProject(intake, ctx, { llm: async () => structuredClone(draft), model: "stub", maxAttempts: 1 })).history[0];
  // the section citations in this fixture are written for the full intake, so only the missing-information line is asserted here
  assert.ok(!ids.errors.some((e) => /not listed under missingInformation/.test(e)), ids.errors.join("\n"));
});

test("withMissingInformation adds what is missing and never removes what the model said", () => {
  const intake = structuredClone(goodIntake); intake.manufacturer = null;
  const out = withMissingInformation({ ...goodDraft, missingInformation: ["roof access photos"] }, intake) as Draft;
  assert.deepEqual(out.missingInformation, ["roof access photos", "manufacturer or product name"]);
});

test("MUTANT: with the merge removed the same draft fails the validator", async () => {
  const intake = structuredClone(goodIntake); intake.manufacturer = null;
  const { validateDraft } = await import("./index.ts");
  const r = validateDraft({ ...goodDraft, missingInformation: [] }, intake, ctx);
  assert.match(r.errors.join("\n"), /not listed under missingInformation/);
});
