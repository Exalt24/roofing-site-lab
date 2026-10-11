// Structured data. Only types Google documents, only values that are visible on the page. No FAQ markup (rich results retired 2026-05), no self-review stars.
import type { Business, Page, Project, Service, Dataset } from "@lab/content";
import { imgUrl } from "./img.ts";
import { BUILD_DATE } from "./dates.ts";

const abs = (b: Business, url: string) => new URL(url, b.url).toString();
// Google reads each page on its own, so a page that names the business names it in full instead of pointing at an @id that is only defined on the home page
const org = (b: Business) => ({ "@type": "RoofingContractor", name: b.name, url: b.url, telephone: b.telephone });

export function roofingContractor(b: Business) {
  return {
    "@context": "https://schema.org",
    "@type": "RoofingContractor",
    "@id": abs(b, "/#business"),
    name: b.name,
    legalName: b.legalName,
    url: b.url,
    telephone: b.telephone, // ALWAYS the real number; call tracking only ever changes the visible text for tracked visits
    email: b.email,
    address: { "@type": "PostalAddress", streetAddress: b.streetAddress, addressLocality: b.city, addressRegion: b.region, postalCode: b.postalCode, addressCountry: b.country },
    areaServed: b.areaServed.map((name) => ({ "@type": "City", name })),
    ...(b.sameAs.length ? { sameAs: b.sameAs } : {}),
  };
}

export function breadcrumbs(b: Business, page: Page) {
  if (!page.breadcrumbs.length) return null;
  const items = [...page.breadcrumbs, { url: page.url, text: page.title }];
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((l, i) => ({ "@type": "ListItem", position: i + 1, name: l.text, item: abs(b, l.url) })),
  };
}

export function projectArticle(b: Business, p: Project) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: p.title,
    description: p.summary,
    datePublished: BUILD_DATE,
    dateModified: BUILD_DATE,
    author: org(b),
    publisher: org(b),
    mainEntityOfPage: abs(b, `/projects/${p.slug}/`),
    image: p.photos.map((ph) => ({ "@type": "ImageObject", contentUrl: imgUrl(ph.file, 1200), caption: ph.caption, creator: { "@type": "Organization", name: b.name }, creditText: b.name, copyrightNotice: `© ${b.name}` })),
  };
}

export function videoObjects(b: Business, p: Project) {
  return p.videos.map((v) => ({
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: v.title,
    description: `${v.title}, part of the project: ${p.title}`,
    thumbnailUrl: v.poster.startsWith("http") ? imgUrl(v.poster, 800) : imgUrl(p.photos.find((x) => x.id === v.poster)?.file ?? "", 800),
    uploadDate: BUILD_DATE,
    contentUrl: v.file.startsWith("http") ? v.file : abs(b, `/videos/${v.file}`),
    duration: `PT${v.durationSeconds}S`,
  }));
}

export function serviceSchema(b: Business, s: Service) {
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name: s.name,
    description: s.summary,
    provider: org(b),
    areaServed: b.areaServed.map((name) => ({ "@type": "City", name })),
  };
}

export function all(ds: Dataset, page: Page, project?: Project, service?: Service) {
  const out: unknown[] = [];
  if (page.type === "home") out.push(roofingContractor(ds.business));
  const bc = breadcrumbs(ds.business, page);
  if (bc) out.push(bc);
  if (project) { out.push(projectArticle(ds.business, project)); out.push(...videoObjects(ds.business, project)); }
  if (service) out.push(serviceSchema(ds.business, service));
  return out;
}
