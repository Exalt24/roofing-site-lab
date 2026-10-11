import { test } from "node:test";
import assert from "node:assert/strict";
import { draftProject, buildDocs, writeDrafts, assertDraftId, type Draft, type LlmFn } from "./index.ts";
import { goodDraft, goodIntake, sampleContext } from "./fixtures.ts";

const ctx = sampleContext();
const bad = (): Draft => { const d = structuredClone(goodDraft); d.sections[2].body += " It carries a lifetime warranty."; return d; };

test("a bad first draft is fed its own validator errors and the second attempt is accepted", async () => {
  const seen: string[] = [];
  const outputs: Draft[] = [bad(), structuredClone(goodDraft)];
  const llm: LlmFn = async ({ user }) => { seen.push(user); return outputs.shift()!; };
  const r = await draftProject(goodIntake, ctx, { llm, model: "stub" });
  assert.equal(r.status, "ready_for_review");
  assert.equal(r.attempts, 2);
  assert.match(seen[1], /Your previous draft failed these checks/);
  assert.match(seen[1], /banned claim/);
});

test("MUTANT: a model that never gets it right ends as needs_human, never ready", async () => {
  const llm: LlmFn = async () => bad();
  const r = await draftProject(goodIntake, ctx, { llm, model: "stub", maxAttempts: 3 });
  assert.equal(r.status, "needs_human");
  assert.equal(r.attempts, 3);
  assert.ok(r.draft, "the best effort is kept so a person can read it");
});

test("a model call that throws is recorded and retried, not swallowed", async () => {
  let n = 0;
  const llm: LlmFn = async () => { if (++n === 1) throw new Error("503 upstream"); return structuredClone(goodDraft); };
  const r = await draftProject(goodIntake, ctx, { llm, model: "stub" });
  assert.equal(r.status, "ready_for_review");
  assert.match(r.history[0].errors.join(), /model call failed: 503 upstream/);
});

test("the idempotency key is stable for the same input and changes when the input changes", async () => {
  const llm: LlmFn = async () => structuredClone(goodDraft);
  const a = await draftProject(goodIntake, ctx, { llm, model: "stub" });
  const b = await draftProject(structuredClone(goodIntake), ctx, { llm, model: "stub" });
  const changed = structuredClone(goodIntake); changed.squareFeet = 2300;
  const c = await draftProject(changed, ctx, { llm, model: "stub" });
  assert.equal(a.idempotencyKey, b.idempotencyKey);
  assert.notEqual(a.idempotencyKey, c.idempotencyKey);
});

test("the private customer record never reaches the model", async () => {
  let prompt = "";
  const llm: LlmFn = async ({ system, user }) => { prompt = system + user; return structuredClone(goodDraft); };
  await draftProject(goodIntake, ctx, { llm, model: "stub" });
  for (const secret of ["Marguerite", "Tallow", "Birchwood", "604-555-0199", "marguerite.tallow@example.com"]) assert.equal(prompt.includes(secret), false, secret);
});

test("the writer only ever produces draft ids and refuses anything else", async () => {
  const llm: LlmFn = async () => structuredClone(goodDraft);
  const run = await draftProject(goodIntake, ctx, { llm, model: "stub" });
  const docs = buildDocs(run, goodIntake, { "ph-a": "image-aaa", "ph-b": "image-bbb" });
  assert.ok(docs.length === 2 && docs.every((d) => String(d._id).startsWith("drafts.")));
  assert.throws(() => assertDraftId("project-p01"), /may only create draft documents/);
  const written: string[] = [];
  const client = { transaction() { const tx = { createOrReplace(doc: Record<string, unknown>) { written.push(String(doc._id)); return tx; }, createIfNotExists(doc: Record<string, unknown>) { written.push(String(doc._id)); return tx; }, commit: async () => ({}) }; return tx; } };
  const ids = await writeDrafts(client, run, goodIntake, { "ph-a": "image-aaa" });
  assert.deepEqual(ids, written);
  assert.ok(written.every((id) => id.startsWith("drafts.")));
});

test("MUTANT: a writer handed a published id is refused", () => {
  const llm = async () => structuredClone(goodDraft);
  return draftProject(goodIntake, ctx, { llm: llm as LlmFn, model: "stub" }).then((run) => {
    const docs = buildDocs(run, goodIntake, {});
    docs[0]._id = String(docs[0]._id).replace("drafts.", "");
    assert.throws(() => assertDraftId(String(docs[0]._id)), /refusing to write/);
  });
});

test("a customer detail typed into an intake box is refused before any model call, naming the box", async () => {
  let called = 0;
  const llm: LlmFn = async () => { called++; return structuredClone(goodDraft); };
  const leaky = structuredClone(goodIntake);
  leaky.staffNotes = "Homeowner Marguerite wants the quote sent to marguerite.tallow@example.com";
  leaky.whatWasHard = "Call 604-555-0199 before arriving";
  const r = await draftProject(leaky, ctx, { llm, model: "stub" });
  assert.equal(called, 0, "nothing was sent to the model");
  assert.equal(r.status, "needs_human"); assert.equal(r.attempts, 0); assert.equal(r.draft, null);
  const msg = r.lastReport.errors.join(" | ");
  assert.match(msg, /Marguerite.*staff notes box/); assert.match(msg, /email address is typed in the staff notes box/); assert.match(msg, /phone number is typed in the what was hard box/);
});

test("a re-run never overwrites the draft a person has edited: the project is created only if absent, and a bad job id is refused", async () => {
  const llm: LlmFn = async () => structuredClone(goodDraft);
  const run = await draftProject(goodIntake, ctx, { llm, model: "stub" });
  const calls: string[] = [];
  const client = { transaction() { const tx = { createOrReplace(d: Record<string, unknown>) { calls.push("replace:" + d._type); return tx; }, createIfNotExists(d: Record<string, unknown>) { calls.push("ifnot:" + d._type); return tx; }, commit: async () => ({}) }; return tx; } };
  await writeDrafts(client, run, goodIntake, { "ph-a": "image-aaa" });
  assert.deepEqual(calls.sort(), ["ifnot:project", "replace:aiRun"]);
  assert.throws(() => buildDocs(run, { ...goodIntake, jobId: "../../published" }, {}), /job id/);
});

test("MUTANT: the draft-only guard refuses a document that is not in the drafts namespace", async () => {
  const { assertAllDrafts } = await import("./index.ts");
  assert.throws(() => assertAllDrafts([{ _id: "drafts.ok" }, { _id: "project-p01" }]), /may only create draft documents/);
  assert.doesNotThrow(() => assertAllDrafts([{ _id: "drafts.ok" }]));
});

test("MUTANT: a photo id named like an object property does not become an asset reference", async () => {
  const draft = structuredClone(goodDraft); draft.photos[0].photoId = "constructor";
  const r = await draftProject(goodIntake, ctx, { llm: async () => structuredClone(draft), model: "stub", maxAttempts: 1 });
  const docs = buildDocs(r, goodIntake, {});
  const project = docs.find((d) => d._type === "project") as { photos?: unknown[] } | undefined;
  assert.ok(!project || (project.photos ?? []).every((p) => (p as { asset: { _ref?: unknown } }).asset._ref !== undefined && typeof (p as { asset: { _ref?: unknown } }).asset._ref === "string"));
});

test("MUTANT: a malformed best-effort draft is kept in the aiRun record and writing it does not crash or build a project document", async () => {
  for (const wrong of [{ title: "x" }, { ...structuredClone(goodDraft), sections: "oops" }, { ...structuredClone(goodDraft), photos: null }, { ...structuredClone(goodDraft), photos: [null] }]) {
    const r = await draftProject(goodIntake, ctx, { llm: async () => wrong as never, model: "stub", maxAttempts: 1 });
    assert.equal(r.status, "needs_human");
    const docs = buildDocs(r, goodIntake, {});
    assert.deepEqual(docs.map((d) => d._type), ["aiRun"]);
  }
});

test("MUTANT: a draft that failed the checks is written with NEEDS A PERSON at the front of its title, a clean one is not", async () => {
  const okRun = await draftProject(goodIntake, ctx, { llm: async () => structuredClone(goodDraft), model: "stub" });
  const failRun = await draftProject(goodIntake, ctx, { llm: async () => bad(), model: "stub", maxAttempts: 1 });
  assert.equal(failRun.status, "needs_human");
  const title = (r: typeof okRun) => String((buildDocs(r, goodIntake, {}).find((d) => d._type === "project") as { title: string }).title);
  assert.equal(title(okRun).startsWith("NEEDS A PERSON"), false);
  assert.ok(title(failRun).startsWith("NEEDS A PERSON: "));
});
