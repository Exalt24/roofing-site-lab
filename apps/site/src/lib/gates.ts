// The checks that stop a bad site from being built. getStaticPaths calls assertContentGates, so a failure ends the build and nothing is deployed.
import { buildGraph, checkGraph, swapTest, duplicateGate, validateProject, type Dataset } from "@lab/content";

export function assertContentGates(ds: Dataset) {
  // every published project must pass the entry checks (thin story, lazy alt text, a review without consent, no homeowner photo release, a result written ahead of the calendar)
  const entryProblems = ds.projects.filter((p) => p.status === "published").flatMap((p) => validateProject(p, ds));
  if (entryProblems.length) throw new Error("Project entry check failed:\n" + entryProblems.join("\n"));
  const graph = buildGraph(ds);
  // the build refuses to ship a graph with orphans, broken links, doorway-like area pages or near-duplicate narratives
  for (const gate of [checkGraph(graph), swapTest(ds, graph), duplicateGate(graph)]) {
    if (!gate.ok) throw new Error("Content gate failed:\n" + gate.problems.join("\n"));
  }
  return graph;
}
