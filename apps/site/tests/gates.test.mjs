// The build refuses to ship a bad site: assertContentGates throws on each kind of defect, and the page template really calls it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sampleDataset } from "@lab/content";
import { assertContentGates } from "../src/lib/gates.ts";

const clone = (x) => structuredClone(x);

test("the sample passes every gate", () => {
  const g = assertContentGates(sampleDataset);
  assert.ok(g.pages.length >= 30);
});

test("MUTANT: a project without the homeowner's photo release stops the build", () => {
  const ds = clone(sampleDataset); ds.projects.find((p) => p.status === "published").photoRelease = false;
  assert.throws(() => assertContentGates(ds), /Project entry check failed[\s\S]*photo release/);
});

test("MUTANT: a result written ahead of the calendar stops the build", () => {
  const ds = clone(sampleDataset); const p = ds.projects.find((x) => x.status === "published");
  p.completedOn = new Date(Date.now() - 20 * 86400000).toISOString().slice(0, 10); p.outcome = "The roof has come through its first stormy season with no leaks.";
  assert.throws(() => assertContentGates(ds), /stormy season/);
});

test("MUTANT: two near-identical project narratives stop the build", () => {
  const ds = clone(sampleDataset);
  const [a, b] = ds.projects.filter((p) => p.status === "published");
  for (const k of ["existingConditions", "challenges", "solution", "outcome", "summary"]) b[k] = a[k];
  assert.throws(() => assertContentGates(ds), /Content gate failed/);
});

test("MUTANT: an area page that would survive swapping the place name stops the build", () => {
  const ds = clone(sampleDataset);
  const [n1, n2] = ds.neighbourhoods.filter((n) => ds.projects.filter((p) => p.status === "published" && p.neighbourhoodSlug === n.slug).length >= 2);
  n2.facts = n1.facts.split(n1.name).join(n2.name);
  assert.throws(() => assertContentGates(ds), /same once the place name is masked/);
});

test("the page template calls the gates before it returns any path, so removing the call is caught here", () => {
  const src = readFileSync(new URL("../src/pages/[...slug].astro", import.meta.url), "utf8");
  const gates = src.indexOf("assertContentGates(ds)");
  const paths = src.indexOf("return graph.pages");
  assert.ok(gates > 0 && paths > gates, "getStaticPaths must run assertContentGates(ds) before it returns the pages");
});
