// The JSON Schema handed to the model (strict structured output), and the runtime shape check (the API does not enforce lengths).
import type { Draft } from "./types.ts";

export const PROMPT_VERSION = "draft-v1";

export const DRAFT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "summary", "sections", "seo", "photos", "relatedServiceSlugs", "relatedNeighbourhoodSlug", "internalLinkSuggestions", "missingInformation"],
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["key", "body", "supportedBy"],
        properties: {
          key: { type: "string", enum: ["existingConditions", "challenges", "solution", "outcome"] },
          body: { type: "string" },
          supportedBy: { type: "array", items: { type: "string" } },
        },
      },
    },
    seo: { type: "object", additionalProperties: false, required: ["title", "description"], properties: { title: { type: "string" }, description: { type: "string" } } },
    photos: { type: "array", items: { type: "object", additionalProperties: false, required: ["photoId", "alt", "caption"], properties: { photoId: { type: "string" }, alt: { type: "string" }, caption: { type: "string" } } } },
    relatedServiceSlugs: { type: "array", items: { type: "string" } },
    relatedNeighbourhoodSlug: { type: "string" },
    internalLinkSuggestions: { type: "array", items: { type: "object", additionalProperties: false, required: ["anchor", "targetUrl", "why"], properties: { anchor: { type: "string" }, targetUrl: { type: "string" }, why: { type: "string" } } } },
    missingInformation: { type: "array", items: { type: "string" } },
  },
} as const;

export function shapeErrors(x: unknown): string[] {
  const errs: string[] = [];
  const d = x as Partial<Draft> | null;
  if (!d || typeof d !== "object") return ["draft is not an object"];
  const str = (v: unknown, name: string) => { if (typeof v !== "string" || !v.trim()) errs.push(`${name} must be a non-empty string`); };
  str(d.title, "title"); str(d.summary, "summary");
  if (!Array.isArray(d.sections) || !d.sections.length) errs.push("sections must be a non-empty array");
  else for (const [i, s] of d.sections.entries()) {
    if (!["existingConditions", "challenges", "solution", "outcome"].includes(s?.key as string)) errs.push(`sections[${i}].key invalid`);
    str(s?.body, `sections[${i}].body`);
    if (!Array.isArray(s?.supportedBy)) errs.push(`sections[${i}].supportedBy must be an array`);
  }
  str(d.seo?.title, "seo.title"); str(d.seo?.description, "seo.description");
  if (!Array.isArray(d.photos)) errs.push("photos must be an array");
  if (!Array.isArray(d.relatedServiceSlugs)) errs.push("relatedServiceSlugs must be an array");
  if (typeof d.relatedNeighbourhoodSlug !== "string") errs.push("relatedNeighbourhoodSlug must be a string");
  if (!Array.isArray(d.internalLinkSuggestions)) errs.push("internalLinkSuggestions must be an array");
  if (!Array.isArray(d.missingInformation)) errs.push("missingInformation must be an array");
  return errs;
}
