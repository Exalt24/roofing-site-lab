import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGraph, checkGraph, swapTest, duplicateGate, validateProject, sampleDataset, MIN_PROJECTS_FOR_AREA_PAGE, type Dataset, type Project } from "./index.ts";

const clone = <T>(x: T): T => structuredClone(x);

test("every sample project passes the entry checks", () => {
  for (const p of sampleDataset.projects) assert.deepEqual(validateProject(p, sampleDataset), [], p.id);
});

test("a draft project never reaches the public graph", () => {
  const g = buildGraph(sampleDataset);
  assert.equal(g.pages.some((p) => p.url.includes("lynn-valley")), false);
});

test("area pages exist only where completed projects stand behind them", () => {
  const g = buildGraph(sampleDataset);
  const areas = g.pages.filter((p) => p.type === "area").map((p) => p.url).sort();
  assert.deepEqual(areas, ["/areas/ambleside/", "/areas/british-properties/", "/areas/caulfeild/", "/areas/dundarave/"]);
  assert.ok(g.skipped.some((s) => s.neighbourhood === "horseshoe-bay"), "one project is not enough for a page");
  assert.ok(g.areaNamesWithoutPage.includes("Horseshoe Bay"));
  for (const a of g.pages.filter((p) => p.type === "area")) assert.ok(a.projectIds.length >= MIN_PROJECTS_FOR_AREA_PAGE, a.url);
});

test("entering a project once connects it to its service, material, area and related projects", () => {
  const g = buildGraph(sampleDataset);
  const page = g.pages.find((p) => p.url === "/projects/british-properties-cedar-replacement/")!;
  const urls = page.links.map((l) => l.url);
  assert.ok(urls.includes("/services/cedar-roofing/"));
  assert.ok(urls.includes("/materials/cedar-shake/"));
  assert.ok(urls.includes("/areas/british-properties/"));
  assert.ok(g.pages.find((p) => p.url === "/services/cedar-roofing/")!.links.some((l) => l.url === page.url), "and the service page links back down");
});

test("the graph has no orphans, no broken links and every page is reachable from home", () => {
  const r = checkGraph(buildGraph(sampleDataset));
  assert.deepEqual(r.problems, []);
});

test("the swap test passes on the sample areas and the duplicate gate passes on the narratives", () => {
  const g = buildGraph(sampleDataset);
  assert.deepEqual(swapTest(sampleDataset, g).problems, []);
  assert.deepEqual(duplicateGate(g).problems, []);
});

// ---- mutation controls: each gate must FAIL on the defect it exists for ----

test("MUTANT: two area pages that differ only by the place name fail the swap test", () => {
  const ds: Dataset = clone(sampleDataset);
  const a = ds.neighbourhoods.find((n) => n.slug === "ambleside")!;
  const d = ds.neighbourhoods.find((n) => n.slug === "dundarave")!;
  d.facts = a.facts.replaceAll("Ambleside", "Dundarave");
  const r = swapTest(ds, buildGraph(ds));
  assert.equal(r.ok, false);
  assert.match(r.problems.join(" "), /the same once the place name is masked/);
});

test("MUTANT: a neighbourhood with one project gets no page even when forced through a wrong threshold check", () => {
  const ds: Dataset = clone(sampleDataset);
  ds.projects = ds.projects.filter((p) => p.id !== "p10"); // caulfeild drops to one project
  const g = buildGraph(ds);
  assert.equal(g.pages.some((p) => p.url === "/areas/caulfeild/"), false);
  assert.equal(checkGraph(g).ok, true, "and the rest of the graph stays consistent");
});

test("MUTANT: a copied project narrative fails the duplicate gate", () => {
  const ds: Dataset = clone(sampleDataset);
  const a = ds.projects.find((p) => p.id === "p01")!;
  const b = ds.projects.find((p) => p.id === "p09")!;
  b.existingConditions = a.existingConditions; b.challenges = a.challenges; b.solution = a.solution; b.outcome = a.outcome; b.summary = a.summary;
  assert.equal(duplicateGate(buildGraph(ds)).ok, false);
});

test("MUTANT: an orphaned page and a broken link are both caught", () => {
  const g = buildGraph(sampleDataset);
  g.pages.push({ url: "/projects/ghost/", type: "project", title: "x", canonical: "/projects/ghost/", breadcrumbs: [], links: [{ url: "/nowhere/", text: "x" }], projectIds: [], text: "" });
  const r = checkGraph(g);
  assert.equal(r.ok, false);
  assert.match(r.problems.join("\n"), /orphan page \/projects\/ghost\//);
  assert.match(r.problems.join("\n"), /missing page \/nowhere\//);
});

test("a published project without the homeowner's photo release is refused, a draft is not", () => {
  const published: Project = { ...clone(sampleDataset.projects[0]), photoRelease: false };
  assert.ok(validateProject(published, sampleDataset).some((e) => /photo release/.test(e)));
  assert.deepEqual(validateProject({ ...published, status: "draft" }, sampleDataset).filter((e) => /photo release/.test(e)), []);
  assert.deepEqual(validateProject({ ...published, photoRelease: true }, sampleDataset), []);
});

test("entry checks refuse a thin project, a lazy alt text and a review without consent", () => {
  const p: Project = clone(sampleDataset.projects[0]);
  p.challenges = "hard";
  p.photos[0].alt = "Image of a roof";
  p.review = { quote: "Great", author: "A.", consent: false };
  const errs = validateProject(p, sampleDataset);
  assert.ok(errs.some((e) => /challenges/.test(e)));
  assert.ok(errs.some((e) => /alt text/.test(e)));
  assert.ok(errs.some((e) => /consent/.test(e)));
});
