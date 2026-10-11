// Loads the dataset. Production build: from Sanity (published documents only). No project id set (CI, tests): the in-repo fixtures.
import { createClient } from "@sanity/client";
import { sampleDataset, type Dataset, type Project } from "@lab/content";

const QUERY = `{
  "business": *[_id == "business"][0]{ name, legalName, telephone, email, streetAddress, city, region, postalCode, country, url, sameAs, areaServed, credentials },
  "services": *[_type == "service"] | order(name){ name, "slug": slug.current, summary, body },
  "materials": *[_type == "material"] | order(name){ name, "slug": slug.current, summary },
  "neighbourhoods": *[_type == "neighbourhood"] | order(name){ name, "slug": slug.current, city, facts },
  "projects": *[_type == "project" && !(_id in path("drafts.**"))] | order(completedOn desc){
    "id": _id, featured, title, "slug": slug.current, summary, "neighbourhoodSlug": neighbourhood->slug.current, roofType,
    "serviceSlugs": services[]->slug.current, "materialSlugs": materials[]->slug.current,
    manufacturer, colour, existingConditions, challenges, solution, outcome, completedOn, squareFeet, durationDays,
    "photos": photos[]{ "id": _key, "file": asset->url, alt, caption, stage, "width": asset->metadata.dimensions.width, "height": asset->metadata.dimensions.height },
    "videos": videos[]{ "id": _key, title, durationSeconds, "file": file.asset->url, "poster": poster.asset->url },
    photoRelease,
    "review": select(review.consent == true => review)
  }
}`;

let cached: Promise<Dataset> | null = null;

export function loadDataset(): Promise<Dataset> {
  if (!cached) cached = fetchDataset();
  return cached;
}

async function fetchDataset(): Promise<Dataset> {
  const projectId = import.meta.env.SANITY_PROJECT_ID ?? process.env.SANITY_PROJECT_ID;
  if (!projectId) return sampleDataset;
  const client = createClient({ projectId, dataset: import.meta.env.SANITY_DATASET ?? process.env.SANITY_DATASET ?? "production", apiVersion: "2025-02-19", useCdn: false, perspective: "published" });
  const raw = await client.fetch<Omit<Dataset, "projects"> & { projects: Array<Omit<Project, "status" | "serviceSlugs"> & { serviceSlugs: string[] | null; materialSlugs: string[] | null; videos: Project["videos"] | null }> }>(QUERY);
  const site = import.meta.env.SITE_URL ?? process.env.SITE_URL;
  const business = { ...raw.business, sameAs: raw.business.sameAs ?? [], areaServed: raw.business.areaServed ?? [], credentials: raw.business.credentials ?? [], ...(site ? { url: site } : {}) };
  const projects: Project[] = raw.projects.map((p) => ({ ...p, status: "published", serviceSlugs: p.serviceSlugs ?? [], materialSlugs: p.materialSlugs ?? [], videos: p.videos ?? [] }));
  return { business, services: raw.services, materials: raw.materials, neighbourhoods: raw.neighbourhoods, projects };
}
