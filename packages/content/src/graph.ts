// Turns the entered projects into the whole page graph. Nothing here is typed in twice.
// The rule that keeps location pages honest: a neighbourhood page exists ONLY when real completed projects stand behind it.
import type { Dataset, Project } from "./model.ts";
import { maskName, similarity } from "./similarity.ts";

export const MIN_PROJECTS_FOR_AREA_PAGE = 2;
export const MIN_FACT_WORDS = 25;

export type PageType = "home" | "projects-index" | "project" | "services-index" | "service" | "material" | "areas-index" | "area";

export interface Link { url: string; text: string }
export interface Page {
  url: string;
  type: PageType;
  title: string;
  canonical: string;
  breadcrumbs: Link[];
  links: Link[]; // outbound internal links
  projectIds: string[]; // projects shown on this page
  text: string; // the page's own words, used by the duplicate and swap gates
}

export interface Graph {
  pages: Page[];
  areaNamesWithoutPage: string[];
  skipped: { neighbourhood: string; reason: string }[];
}

const published = (ps: Project[]) => ps.filter((p) => p.status === "published");
const homeOrder = (ps: Project[]) => [...ps.filter((p) => p.featured), ...ps.filter((p) => !p.featured)];

export function buildGraph(ds: Dataset): Graph {
  const projects = published(ds.projects).sort((a, b) => b.completedOn.localeCompare(a.completedOn));
  const pages: Page[] = [];
  const skipped: Graph["skipped"] = [];
  const home: Link = { url: "/", text: "Home" };
  const byN = (slug: string) => projects.filter((p) => p.neighbourhoodSlug === slug);

  // neighbourhood pages only where real work exists
  const areaOk = new Set<string>();
  for (const n of ds.neighbourhoods) {
    const ps = byN(n.slug);
    const factWords = n.facts.trim().split(/\s+/).filter(Boolean).length;
    if (ps.length < MIN_PROJECTS_FOR_AREA_PAGE) skipped.push({ neighbourhood: n.slug, reason: `only ${ps.length} completed project(s), needs ${MIN_PROJECTS_FOR_AREA_PAGE}` });
    else if (factWords < MIN_FACT_WORDS) skipped.push({ neighbourhood: n.slug, reason: `local facts are ${factWords} words, needs ${MIN_FACT_WORDS}` });
    else areaOk.add(n.slug);
  }
  const areaUrl = (slug: string) => `/areas/${slug}/`;
  const projectUrl = (p: Project) => `/projects/${p.slug}/`;
  const related = (p: Project) => projects
    .filter((q) => q.id !== p.id)
    .map((q) => ({ q, score: q.serviceSlugs.filter((s) => p.serviceSlugs.includes(s)).length * 2 + q.materialSlugs.filter((m) => p.materialSlugs.includes(m)).length + (q.neighbourhoodSlug === p.neighbourhoodSlug ? 1 : 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.q.completedOn.localeCompare(a.q.completedOn))
    .slice(0, 3)
    .map((x) => x.q);

  // home
  pages.push({
    url: "/", type: "home", title: ds.business.name, canonical: "/", breadcrumbs: [],
    links: [
      { url: "/projects/", text: "Completed projects" }, { url: "/services/", text: "Roofing services" }, { url: "/areas/", text: "Areas we serve" },
      ...homeOrder(projects).slice(0, 3).map((p) => ({ url: projectUrl(p), text: p.title })),
    ],
    projectIds: homeOrder(projects).slice(0, 3).map((p) => p.id),
    text: ds.business.name,
  });

  // projects
  pages.push({
    url: "/projects/", type: "projects-index", title: "Completed roofing projects", canonical: "/projects/", breadcrumbs: [home],
    links: projects.map((p) => ({ url: projectUrl(p), text: p.title })), projectIds: projects.map((p) => p.id), text: "",
  });
  for (const p of projects) {
    const svc = ds.services.filter((s) => p.serviceSlugs.includes(s.slug));
    const mat = ds.materials.filter((m) => p.materialSlugs.includes(m.slug));
    const n = ds.neighbourhoods.find((x) => x.slug === p.neighbourhoodSlug)!;
    const links: Link[] = [
      ...svc.map((s) => ({ url: `/services/${s.slug}/`, text: s.name })),
      ...mat.map((m) => ({ url: `/materials/${m.slug}/`, text: m.name })),
      ...(areaOk.has(n.slug) ? [{ url: areaUrl(n.slug), text: `More work in ${n.name}` }] : []),
      ...related(p).map((q) => ({ url: projectUrl(q), text: q.title })),
    ];
    pages.push({
      url: projectUrl(p), type: "project", title: p.title, canonical: projectUrl(p),
      breadcrumbs: [home, { url: "/projects/", text: "Projects" }], links, projectIds: [p.id],
      text: [p.title, p.summary, p.existingConditions, p.challenges, p.solution, p.outcome].join(" "),
    });
  }

  // services (a service page exists because the company offers it; it links down to proof)
  pages.push({ url: "/services/", type: "services-index", title: "Roofing services", canonical: "/services/", breadcrumbs: [home], links: ds.services.map((s) => ({ url: `/services/${s.slug}/`, text: s.name })), projectIds: [], text: "" });
  for (const s of ds.services) {
    const ps = projects.filter((p) => p.serviceSlugs.includes(s.slug));
    pages.push({
      url: `/services/${s.slug}/`, type: "service", title: s.name, canonical: `/services/${s.slug}/`,
      breadcrumbs: [home, { url: "/services/", text: "Services" }],
      links: ps.map((p) => ({ url: projectUrl(p), text: p.title })), projectIds: ps.map((p) => p.id), text: [s.name, s.summary, s.body].join(" "),
    });
  }

  // materials only when there is at least one completed project in that material
  for (const m of ds.materials) {
    const ps = projects.filter((p) => p.materialSlugs.includes(m.slug));
    if (!ps.length) { skipped.push({ neighbourhood: `material:${m.slug}`, reason: "no completed project in this material" }); continue; }
    pages.push({
      url: `/materials/${m.slug}/`, type: "material", title: m.name, canonical: `/materials/${m.slug}/`,
      breadcrumbs: [home, { url: "/services/", text: "Services" }],
      links: ps.map((p) => ({ url: projectUrl(p), text: p.title })), projectIds: ps.map((p) => p.id), text: [m.name, m.summary].join(" "),
    });
  }

  // areas
  const areaNamesWithoutPage = ds.neighbourhoods.filter((n) => !areaOk.has(n.slug)).map((n) => n.name);
  pages.push({
    url: "/areas/", type: "areas-index", title: "Areas we serve", canonical: "/areas/", breadcrumbs: [home],
    links: ds.neighbourhoods.filter((n) => areaOk.has(n.slug)).map((n) => ({ url: areaUrl(n.slug), text: n.name })), projectIds: [], text: "",
  });
  for (const n of ds.neighbourhoods.filter((x) => areaOk.has(x.slug))) {
    const ps = byN(n.slug);
    const svcSlugs = [...new Set(ps.flatMap((p) => p.serviceSlugs))];
    pages.push({
      url: areaUrl(n.slug), type: "area", title: `Roofing projects in ${n.name}`, canonical: areaUrl(n.slug),
      breadcrumbs: [home, { url: "/areas/", text: "Areas" }],
      links: [...ps.map((p) => ({ url: projectUrl(p), text: p.title })), ...ds.services.filter((s) => svcSlugs.includes(s.slug)).map((s) => ({ url: `/services/${s.slug}/`, text: s.name }))],
      projectIds: ps.map((p) => p.id), text: n.facts,
    });
  }
  return { pages, areaNamesWithoutPage, skipped };
}

// ---- gates -----------------------------------------------------------------

export interface GateResult { ok: boolean; problems: string[] }

export function checkGraph(g: Graph): GateResult {
  const problems: string[] = [];
  const urls = new Set<string>();
  for (const p of g.pages) {
    if (urls.has(p.url)) problems.push(`duplicate url ${p.url}`);
    urls.add(p.url);
    if (p.canonical !== p.url) problems.push(`${p.url}: canonical must be self-referencing`);
  }
  const inbound = new Map<string, number>();
  for (const p of g.pages) for (const l of p.links) {
    if (!urls.has(l.url)) problems.push(`${p.url}: link to missing page ${l.url}`);
    inbound.set(l.url, (inbound.get(l.url) ?? 0) + 1);
  }
  for (const p of g.pages) if (p.url !== "/" && !(inbound.get(p.url) ?? 0)) problems.push(`orphan page ${p.url}`);
  // reachable from home
  const seen = new Set<string>(["/"]);
  const queue = ["/"];
  while (queue.length) {
    const u = queue.pop()!;
    for (const l of g.pages.find((p) => p.url === u)?.links ?? []) if (!seen.has(l.url)) { seen.add(l.url); queue.push(l.url); }
  }
  for (const p of g.pages) if (!seen.has(p.url)) problems.push(`unreachable from home: ${p.url}`);
  return { ok: problems.length === 0, problems };
}

// The swap test: take an area page, mask its neighbourhood name, and compare with every other area page.
// If the words that remain are substantially the same, the page exists only to catch a place name (a doorway page).
export function swapTest(ds: Dataset, g: Graph, threshold = 0.35): GateResult {
  const problems: string[] = [];
  const areas = g.pages.filter((p) => p.type === "area");
  for (let i = 0; i < areas.length; i++) {
    for (let j = i + 1; j < areas.length; j++) {
      const ni = ds.neighbourhoods.find((n) => areaUrlOf(n.slug) === areas[i].url)!;
      const nj = ds.neighbourhoods.find((n) => areaUrlOf(n.slug) === areas[j].url)!;
      const s = similarity(maskName(areas[i].text, ni.name), maskName(areas[j].text, nj.name));
      if (s > threshold) problems.push(`${areas[i].url} and ${areas[j].url} are ${(s * 100).toFixed(0)}% the same once the place name is masked`);
    }
    const own = areas[i];
    const projectsHere = own.projectIds.length;
    if (projectsHere < MIN_PROJECTS_FOR_AREA_PAGE) problems.push(`${own.url} has only ${projectsHere} project(s) behind it`);
  }
  return { ok: problems.length === 0, problems };
}

function areaUrlOf(slug: string) { return `/areas/${slug}/`; }

// Near-duplicate gate across project narratives (what a bulk-generated site fails).
export function duplicateGate(g: Graph, threshold = 0.5): GateResult {
  const problems: string[] = [];
  const ps = g.pages.filter((p) => p.type === "project");
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
    const s = similarity(ps[i].text, ps[j].text);
    if (s > threshold) problems.push(`${ps[i].url} and ${ps[j].url} are ${(s * 100).toFixed(0)}% alike`);
  }
  return { ok: problems.length === 0, problems };
}
