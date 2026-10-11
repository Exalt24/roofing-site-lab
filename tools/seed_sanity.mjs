// Seed the Sanity project from the sample dataset (packages/content/src/sample.ts). Idempotent: createOrReplace with fixed ids, assets cached by file name.
//   node tools/seed_sanity.mjs
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@sanity/client";
import { sampleDataset } from "../packages/content/src/index.ts";
import { sanitySettings } from "./_env.mjs";

const root = path.resolve(import.meta.dirname, "..");
const sn = sanitySettings();
const client = createClient({ projectId: sn.projectId, dataset: sn.dataset, apiVersion: "2025-02-19", token: sn.token, useCdn: false });
const cachePath = path.join(root, "assets", "sanity_assets.json");
const cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, "utf8")) : {};

async function asset(kind, rel) {
  if (cache[rel]) return cache[rel];
  const file = path.join(root, "assets", rel);
  const res = await client.assets.upload(kind, fs.createReadStream(file), { filename: path.basename(file) });
  cache[rel] = res._id;
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 1));
  console.log("uploaded", rel);
  return res._id;
}
const ref = (id, key) => ({ _type: "reference", _ref: id, ...(key ? { _key: key } : {}) });
const slug = (s) => ({ _type: "slug", current: s });

const ds = sampleDataset;
const docs = [];
docs.push({ _id: "business", _type: "business", name: ds.business.name, legalName: ds.business.legalName, telephone: ds.business.telephone, email: ds.business.email, streetAddress: ds.business.streetAddress, city: ds.business.city, region: ds.business.region, postalCode: ds.business.postalCode, country: ds.business.country, url: ds.business.url, sameAs: ds.business.sameAs, areaServed: ds.business.areaServed, credentials: ds.business.credentials });
for (const s of ds.services) docs.push({ _id: `service-${s.slug}`, _type: "service", name: s.name, slug: slug(s.slug), summary: s.summary, body: s.body });
for (const m of ds.materials) docs.push({ _id: `material-${m.slug}`, _type: "material", name: m.name, slug: slug(m.slug), summary: m.summary });
for (const n of ds.neighbourhoods) docs.push({ _id: `neighbourhood-${n.slug}`, _type: "neighbourhood", name: n.name, slug: slug(n.slug), city: n.city, facts: n.facts });
for (const p of ds.projects) {
  const photos = [];
  for (const ph of p.photos) photos.push({ _key: ph.id, _type: "image", asset: ref(await asset("image", `source/${ph.file}`)), alt: ph.alt, caption: ph.caption, ...(ph.stage ? { stage: ph.stage } : {}) });
  const videos = [];
  for (const v of p.videos) {
    const poster = ds.projects.flatMap((x) => x.photos).find((x) => x.id === v.poster);
    videos.push({ _key: v.id, _type: "projectVideo", title: v.title, durationSeconds: v.durationSeconds, file: { _type: "file", asset: ref(await asset("file", `videos/${v.file}`)) }, poster: { _type: "image", asset: ref(await asset("image", `source/${poster.file}`)) } });
  }
  docs.push({
    _id: (p.status === "draft" ? "drafts." : "") + `project-${p.id}`, _type: "project", featured: !!p.featured, title: p.title, slug: slug(p.slug), summary: p.summary,
    neighbourhood: ref(`neighbourhood-${p.neighbourhoodSlug}`), roofType: p.roofType,
    services: p.serviceSlugs.map((s) => ref(`service-${s}`, s)), materials: p.materialSlugs.map((m) => ref(`material-${m}`, m)),
    manufacturer: p.manufacturer, colour: p.colour, completedOn: p.completedOn, squareFeet: p.squareFeet, durationDays: p.durationDays,
    existingConditions: p.existingConditions, challenges: p.challenges, solution: p.solution, outcome: p.outcome, photos, videos, photoRelease: !!p.photoRelease, ...(p.review ? { review: p.review } : {}),
  });
}
let tx = client.transaction();
for (const d of docs) tx = tx.createOrReplace(d);
const res = await tx.commit();
console.log("committed", res.results.length, "documents");
