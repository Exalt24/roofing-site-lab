// The content model. A completed job ("project") is entered ONCE; every other page is derived from it (see graph.ts).

export type RoofType = "metal" | "asphalt" | "cedar" | "composite" | "flat" | "skylight" | "solar";

export interface Photo {
  id: string;
  file: string; // file name under assets/source, or a Sanity asset ref once uploaded
  alt: string;
  caption: string;
  stage?: "before" | "during" | "after"; // when in the job it was taken; "during" is work that gets covered up (valleys, flashing, underlayment)
  width: number;
  height: number;
}

export interface Video {
  id: string;
  file: string;
  poster: string; // a photo id (fixtures) or an image URL (Sanity)
  durationSeconds: number;
  title: string;
}

export interface Review {
  quote: string;
  author: string; // first name and initial only, never a full name or address
  consent: boolean;
}

export interface Project {
  id: string;
  slug: string;
  status: "draft" | "published";
  featured?: boolean; // shown first on the home page; its first photo is the hero
  title: string;
  summary: string;
  neighbourhoodSlug: string;
  roofType: RoofType;
  serviceSlugs: string[];
  materialSlugs: string[];
  manufacturer: string;
  colour: string;
  existingConditions: string;
  challenges: string;
  solution: string;
  outcome: string;
  completedOn: string; // ISO date
  squareFeet?: number;
  durationDays?: number;
  photos: Photo[];
  videos: Video[];
  review?: Review;
  photoRelease?: boolean; // the homeowner agreed in writing to photographs of the home being published; a published project without it fails the build
}

export interface Service {
  slug: string;
  name: string;
  summary: string;
  body: string;
}

export interface Material {
  slug: string;
  name: string;
  summary: string;
}

export interface Neighbourhood {
  slug: string;
  name: string;
  city: string;
  facts: string; // what is genuinely local: housing stock, weather exposure, permit notes. Written by a person.
}

export interface Business {
  name: string;
  legalName: string;
  telephone: string; // the CANONICAL number, always in the served HTML and in the JSON-LD
  email: string;
  streetAddress: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  url: string;
  sameAs: string[];
  areaServed: string[];
  credentials?: string[]; // licence, insurance, WorkSafeBC, warranty, manufacturer certifications: what a buyer checks before letting someone on the roof
}

export interface Dataset {
  business: Business;
  services: Service[];
  materials: Material[];
  neighbourhoods: Neighbourhood[];
  projects: Project[];
}

export const ROOF_TYPES: RoofType[] = ["metal", "asphalt", "cedar", "composite", "flat", "skylight", "solar"];

export function validateProject(p: Project, ds: Pick<Dataset, "services" | "materials" | "neighbourhoods">): string[] {
  const errs: string[] = [];
  const need = (cond: boolean, msg: string) => { if (!cond) errs.push(`${p.id}: ${msg}`); };
  need(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.slug), "slug must be lowercase words joined by hyphens");
  need(ROOF_TYPES.includes(p.roofType), "unknown roof type");
  need(p.title.trim().length >= 10, "title too short");
  need(p.challenges.trim().length >= 40, "challenges must say what was actually hard (at least 40 characters)");
  need(p.solution.trim().length >= 40, "solution must say what was installed and why (at least 40 characters)");
  need(p.photos.length >= 1, "at least one photo");
  need(/^\d{4}-\d{2}-\d{2}$/.test(p.completedOn), "completedOn must be an ISO date");
  need(ds.neighbourhoods.some((n) => n.slug === p.neighbourhoodSlug), "unknown neighbourhood");
  for (const s of p.serviceSlugs) need(ds.services.some((x) => x.slug === s), `unknown service ${s}`);
  for (const m of p.materialSlugs) need(ds.materials.some((x) => x.slug === m), `unknown material ${m}`);
  for (const ph of p.photos) need(ph.alt.trim().length >= 12 && !/^(image|photo|picture) of/i.test(ph.alt), `photo ${ph.id} needs a descriptive alt text`);
  if (p.review) need(p.review.consent === true, "a review needs recorded consent before it can be shown");
  if (p.status === "published") need(p.photoRelease === true, "a published project needs the homeowner's photo release (BC Privacy Act s.3: using a likeness to promote services needs consent)");
  return errs;
}
