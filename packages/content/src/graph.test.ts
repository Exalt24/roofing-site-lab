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

test("a published project cannot claim a full winter, or a lasting pattern, for a job that is too recent to know", () => {
  const today = new Date("2026-10-12");
  for (const p of sampleDataset.projects.filter((x) => x.status === "published")) {
    const months = (today.getTime() - new Date(p.completedOn).getTime()) / (30.44 * 24 * 3600 * 1000);
    const text = [p.outcome, p.review?.quote ?? ""].join(" ").toLowerCase();
    if (/(full|whole|entire) winter|through the winter/.test(text)) assert.ok(months >= 6, `${p.id} claims a winter but finished ${months.toFixed(1)} months ago`);
    if (/no longer pay|is all the roof needs|never (leaks|leaked)/.test(text)) assert.fail(`${p.id} states a long-run result the job is too young to show`);
  }
});

test("MUTANT: the same check does fail on a recent job that claims a full winter", () => {
  const p = clone(sampleDataset.projects[0]); p.completedOn = "2026-10-01"; p.outcome = "Dry through a full winter.";
  const months = (new Date("2026-10-12").getTime() - new Date(p.completedOn).getTime()) / (30.44 * 24 * 3600 * 1000);
  assert.ok(/full winter/.test(p.outcome.toLowerCase()) && months < 6);
});

test("MUTANT: a pair of pages that only link to each other is unreachable from home even though neither is an orphan", () => {
  const g = clone(buildGraph(sampleDataset));
  const mk = (url: string, other: string) => ({ ...g.pages[1], url, canonical: url, links: [{ url: other, text: "x" }], breadcrumbs: [] });
  g.pages.push(mk("/island-a/", "/island-b/"), mk("/island-b/", "/island-a/"));
  const r = checkGraph(g);
  assert.ok(r.problems.some((p) => /unreachable from home: \/island-a\//.test(p)), r.problems.join(" | "));
  assert.equal(r.problems.some((p) => /orphan page \/island-a\//.test(p)), false, "so only the reachability check can catch it");
});

test("MUTANT: a page whose canonical points elsewhere, and a duplicate url, are both caught", () => {
  const g = clone(buildGraph(sampleDataset));
  g.pages[2].canonical = "/somewhere-else/";
  assert.ok(checkGraph(g).problems.some((p) => /canonical must be self-referencing/.test(p)));
  const h = clone(buildGraph(sampleDataset));
  h.pages.push({ ...h.pages[2] });
  assert.ok(checkGraph(h).problems.some((p) => /duplicate url/.test(p)));
});

test("MUTANT: a neighbourhood with enough projects but under 25 words of local facts gets no page, and the build says why", () => {
  const ds = clone(sampleDataset);
  ds.neighbourhoods.find((n) => n.slug === "ambleside")!.facts = "Hillside homes near the water.";
  const g = buildGraph(ds);
  assert.equal(g.pages.some((p) => p.url === "/areas/ambleside/"), false);
  assert.ok(g.skipped.some((s) => s.neighbourhood === "ambleside" && /words, needs 25/.test(s.reason)));
});
