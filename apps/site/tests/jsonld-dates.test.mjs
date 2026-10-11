// With CMS dates the structured data carries the real ones; without them it claims none. (The built fixture pages cover the "none" side; this covers the "real dates" side that only the live build has.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { sampleDataset } from "@lab/content";
import { projectArticle, videoObjects } from "../src/lib/jsonld.ts";

const b = sampleDataset.business;
const withVideo = sampleDataset.projects.find((p) => p.videos.length > 0);

test("article and video markup carry the CMS dates when there are some, and no video markup or dates when there are none", () => {
  const dated = { ...withVideo, createdAt: "2026-03-02T10:00:00Z", updatedAt: "2026-04-05T12:00:00Z" };
  const a = projectArticle(b, dated);
  assert.equal(a.datePublished, "2026-03-02"); assert.equal(a.dateModified, "2026-04-05");
  const v = videoObjects(b, dated);
  assert.ok(v.length >= 1); assert.equal(v[0].uploadDate, "2026-03-02");
  const undated = { ...withVideo, createdAt: undefined, updatedAt: undefined };
  const a2 = projectArticle(b, undated);
  assert.equal("datePublished" in a2, false); assert.equal("dateModified" in a2, false);
  assert.deepEqual(videoObjects(b, undated), []);
});
