// Test fixtures: a realistic intake, a context built from the sample site, and a hand-written draft that is correct.
import { buildGraph, sampleDataset } from "@lab/content";
import type { Context, Draft, Intake } from "./types.ts";

export function sampleContext(): Context {
  const ds = sampleDataset;
  const g = buildGraph(ds);
  return {
    neighbourhoods: ds.neighbourhoods.map((n) => ({ slug: n.slug, name: n.name })),
    services: ds.services.map((s) => ({ slug: s.slug, name: s.name })),
    materials: ds.materials.map((m) => ({ slug: m.slug, name: m.name })),
    businessName: ds.business.name,
    existingNarratives: g.pages.filter((p) => p.type === "project").map((p) => ({ id: p.url, text: p.text })),
    pageUrls: g.pages.map((p) => p.url),
  };
}

export const goodIntake: Intake = {
  jobId: "job-1042",
  neighbourhoodSlug: "caulfeild",
  roofType: "asphalt",
  serviceSlugs: ["asphalt-shingle-roofing"],
  materialSlugs: ["architectural-asphalt"],
  manufacturer: "Cascade Shingle Co.",
  colour: "Weathered grey",
  squareFeet: 2200,
  durationDays: 4,
  completedOn: "2026-10-05",
  existingConditions: "A twenty year old shingle roof with lifting tabs on the south slope and a soft spot in the deck above the kitchen.",
  whatWasHard: "The crew found two rotten deck boards under the south slope and a bathroom fan that had been venting straight into the attic.",
  whatWeDid: "We replaced the two rotten deck boards, ran the bathroom fan through the roof with a proper cap, laid new underlayment and installed architectural shingles.",
  outcome: "The attic is dry and the fan now exhausts outside. The owners had no leaks in the first big October storm.",
  staffNotes: "Owner was lovely. A neighbour might want a quote too.",
  photos: [
    { id: "ph-a", file: "asphalt-shingle-replacement.png", staffCaption: "New shingles on the south slope", visibleDescription: "Grey shingles laid in staggered courses across a roof slope" },
    { id: "ph-b", file: "ridge-vent-detail.png", staffCaption: "Fan cap through the roof", visibleDescription: "A ridge cap running along the top of a grey shingle roof under a blue sky" },
  ],
  private: { customerName: "Marguerite Tallow", streetAddress: "4471 Birchwood Crescent", phone: "604-555-0199", email: "marguerite.tallow@example.com" },
};

export const goodDraft: Draft = {
  title: "Shingle reroof with a rerouted bathroom fan in Caulfeild",
  summary: "We re-roofed a twenty year old shingle roof in Caulfeild, replaced two rotten deck boards and sent a bathroom fan outside instead of into the attic.",
  sections: [
    { key: "existingConditions", body: "The roof was twenty years old, with lifting tabs on the south slope and a soft spot in the deck above the kitchen.", supportedBy: ["F10"] },
    { key: "challenges", body: "Under the south slope the crew found two rotten deck boards, and a bathroom fan that had been venting straight into the attic.", supportedBy: ["F11"] },
    { key: "solution", body: "We replaced the two rotten deck boards, ran the bathroom fan through the roof with a proper cap, laid new underlayment and installed architectural shingles from Cascade Shingle Co. in weathered grey.", supportedBy: ["F12", "F5", "F6"] },
    { key: "outcome", body: "The attic is dry and the fan now exhausts outside. The owners had no leaks in the first big October storm.", supportedBy: ["F13"] },
  ],
  seo: { title: "Shingle reroof and fan fix in Caulfeild", description: "How we replaced rotten deck boards, moved a bathroom fan outside and re-roofed a 2,200 square foot house in Caulfeild." },
  photos: [
    { photoId: "ph-a", alt: "Grey shingles laid in staggered courses across a roof slope", caption: "New shingles on the south slope" },
    { photoId: "ph-b", alt: "Ridge cap running along the top of a grey shingle roof under a blue sky", caption: "Fan cap through the roof" },
  ],
  relatedServiceSlugs: ["asphalt-shingle-roofing"],
  relatedNeighbourhoodSlug: "caulfeild",
  internalLinkSuggestions: [{ anchor: "asphalt shingle roofing", targetUrl: "/services/asphalt-shingle-roofing/", why: "The job was a shingle replacement." }],
  missingInformation: [],
};
