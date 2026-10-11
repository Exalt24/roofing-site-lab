import { test } from "node:test";
import assert from "node:assert/strict";
import { validateDraft } from "./index.ts";
import { goodDraft, goodIntake, sampleContext } from "./fixtures.ts";

const ctx = sampleContext();
const clone = <T>(x: T): T => structuredClone(x);

// Found by the first live run on a local 14B model: a correct draft was rejected because Title Case headings and link anchors look like names.
test("REGRESSION: a Title Case heading and anchor text are not mistaken for invented names", () => {
  const d = clone(goodDraft);
  d.title = "Asphalt Shingle Roof Replacement in Caulfeild";
  d.seo.title = "Asphalt Shingle Roof Replacement in Caulfeild";
  d.internalLinkSuggestions = [{ anchor: "Caulfeild Projects", targetUrl: "/projects/", why: "This project is in Caulfeild." }];
  assert.deepEqual(validateDraft(d, goodIntake, ctx).errors, []);
});

test("MUTANT: an invented brand in a Title Case heading is still caught", () => {
  const d = clone(goodDraft);
  d.title = "Mapleridge Roofing Systems Shingle Reroof in Caulfeild";
  assert.match(validateDraft(d, goodIntake, ctx).errors.join("\n"), /brand-like name "Mapleridge Roofing Systems"/);
});
