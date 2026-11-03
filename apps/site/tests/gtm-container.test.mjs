// LIFESPAN: permanent
// The exported Tag Manager container is versioned in the repo (docs/gtm-container.json), so a change to it is reviewed like code. This checks the export is internally consistent:
// every tag fires on a trigger that exists, every variable a tag reads exists, names are unique, and every tag waits for analytics consent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const file = fileURLToPath(new URL("../../../docs/gtm-container.json", import.meta.url));
const load = () => JSON.parse(readFileSync(file, "utf8")).containerVersion;
const BUILT_IN_TRIGGER_FLOOR = 2147479553; // Tag Manager's built-in triggers (All Pages and the like) start at this id

/** The problems in one container export: an empty list means it is consistent. */
export function containerProblems(cv) {
  const problems = [];
  const triggerIds = new Set((cv.trigger ?? []).map((t) => t.triggerId));
  const variableNames = new Set([...(cv.variable ?? []).map((v) => v.name), ...(cv.builtInVariable ?? []).map((v) => v.name)]);
  const names = new Set();
  for (const tag of cv.tag ?? []) {
    if (names.has(tag.name)) problems.push(`duplicate tag name ${tag.name}`);
    names.add(tag.name);
    for (const id of tag.firingTriggerId ?? []) if (!triggerIds.has(id) && Number(id) < BUILT_IN_TRIGGER_FLOOR) problems.push(`${tag.name} fires on missing trigger ${id}`);
    for (const m of JSON.stringify(tag.parameter ?? []).matchAll(/\{\{([^}]+)\}\}/g)) if (!variableNames.has(m[1])) problems.push(`${tag.name} reads missing variable ${m[1]}`);
    const c = tag.consentSettings;
    const needs = c?.consentStatus === "NEEDED" && (c.consentType?.list ?? []).some((x) => x.value === "analytics_storage");
    if (!needs) problems.push(`${tag.name} does not wait for analytics consent`);
  }
  return problems;
}

test("the exported container is consistent and every tag waits for analytics consent", () => {
  const cv = load();
  assert.ok((cv.tag ?? []).length >= 3, "the export should hold the Google tag and both GA4 event tags");
  assert.deepEqual(containerProblems(cv), []);
});

test("mutation control: each kind of defect is reported", () => {
  const base = () => structuredClone(load());
  const a = base(); a.tag[1].firingTriggerId = ["999"];
  assert.ok(containerProblems(a).some((p) => /missing trigger 999/.test(p)));
  const b = base(); b.tag[1].parameter = [{ type: "TEMPLATE", key: "x", value: "{{DLV not_there}}" }];
  assert.ok(containerProblems(b).some((p) => /missing variable DLV not_there/.test(p)));
  const c = base(); c.tag[2].name = c.tag[1].name;
  assert.ok(containerProblems(c).some((p) => /duplicate tag name/.test(p)));
  const d = base(); d.tag[0].consentSettings = { consentStatus: "NOT_SET" };
  assert.ok(containerProblems(d).some((p) => /does not wait for analytics consent/.test(p)));
});
