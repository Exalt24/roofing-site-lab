// Writes the result to Sanity as DRAFT documents only. A person publishes in Studio. The guard is code, not trust:
// the free plan has no create-only token role, so the writer refuses any id that is not in the drafts. namespace and the tests prove it.
import type { Draft, Intake } from "./types.ts";
import type { RunResult } from "./drafter.ts";
import { shapeErrors } from "./schema.ts";

export interface MutationClient { transaction(): { createOrReplace(doc: Record<string, unknown>): any; createIfNotExists(doc: Record<string, unknown>): any; commit(): Promise<unknown> } }

export function assertDraftId(id: string) {
  if (!id.startsWith("drafts.")) throw new Error(`refusing to write ${id}: the AI step may only create draft documents`);
}

export function assertAllDrafts(docs: Record<string, unknown>[]) { for (const doc of docs) assertDraftId(String(doc._id)); }

/** The job id becomes part of a document id, and Sanity ids allow letters, digits, dot, dash and underscore only. */
export function assertJobId(jobId: string) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(jobId)) throw new Error(`job id "${jobId}" must be 1 to 64 letters, digits, dashes or underscores`);
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
const ref = (id: string, key?: string) => ({ _type: "reference", _ref: id, ...(key ? { _key: key } : {}) });

export function buildDocs(run: RunResult, intake: Intake, assetRefs: Record<string, string>): Record<string, unknown>[] {
  assertJobId(intake.jobId);
  const runId = `drafts.airun-${run.idempotencyKey}`;
  const docs: Record<string, unknown>[] = [{
    _id: runId, _type: "aiRun", idempotencyKey: run.idempotencyKey, model: run.model, promptVersion: run.promptVersion, inputHash: run.inputHash, status: run.status,
    validatorReport: JSON.stringify({ attempts: run.attempts, history: run.history }, null, 1), missingInformation: run.missingInformation, outputJson: JSON.stringify(run.draft, null, 1), createdAt: new Date().toISOString(),
  }];
  // a malformed best-effort draft (wrong shape from the model) is kept in the aiRun record for a person to read, but no project document is built from it
  const d = run.draft as Draft | null;
  if (d && shapeErrors(d).length === 0) {
    const sec = (k: string) => d.sections.find((s) => s.key === k)?.body ?? "";
    docs.push({
      _id: `drafts.project-ai-${intake.jobId}`, _type: "project", title: run.status === "ready_for_review" ? d.title : `NEEDS A PERSON: ${d.title}`, slug: { _type: "slug", current: slugify(d.title) }, summary: d.summary,
      neighbourhood: ref(`neighbourhood-${intake.neighbourhoodSlug}`), roofType: intake.roofType,
      services: intake.serviceSlugs.map((s) => ref(`service-${s}`, s)), materials: intake.materialSlugs.map((m) => ref(`material-${m}`, m)),
      manufacturer: intake.manufacturer ?? undefined, colour: intake.colour ?? undefined, completedOn: intake.completedOn, squareFeet: intake.squareFeet ?? undefined, durationDays: intake.durationDays ?? undefined,
      existingConditions: sec("existingConditions"), challenges: sec("challenges"), solution: sec("solution"), outcome: sec("outcome"),
      photos: d.photos.filter((p) => Object.hasOwn(assetRefs, p.photoId) && assetRefs[p.photoId]).map((p) => ({ _key: p.photoId, _type: "image", asset: ref(assetRefs[p.photoId]), alt: p.alt, caption: p.caption })),
      aiRun: { ...ref(runId), _weak: true },
    });
  }
  assertAllDrafts(docs);
  return docs;
}

export async function writeDrafts(client: MutationClient, run: RunResult, intake: Intake, assetRefs: Record<string, string>) {
  const docs = buildDocs(run, intake, assetRefs);
  let tx = client.transaction();
  // The run log is machine-owned, so a retry replaces it. The project draft is a person's to edit: createIfNotExists means a re-run or a re-delivered request never overwrites
  // edits made in Studio. To regenerate a draft, delete it in Studio first.
  for (const d of docs) tx = d._type === "project" ? tx.createIfNotExists(d) : tx.createOrReplace(d);
  await tx.commit();
  return docs.map((d) => d._id as string);
}
