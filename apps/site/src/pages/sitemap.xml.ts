// XML sitemap with image entries. lastmod is the build date: every page is regenerated on each build, and a job's finish date is not a modification date.
import { buildGraph } from "@lab/content";
import { loadDataset } from "../lib/data.ts";
import { imgUrl } from "../lib/img.ts";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function GET() {
  const ds = await loadDataset();
  const graph = buildGraph(ds);
  const base = ds.business.url;
  const urls = [...graph.pages.map((p) => p.url), "/contact/", "/privacy/"];
  const body = urls.map((u) => {
    const page = graph.pages.find((p) => p.url === u);
    const projects = (page?.projectIds ?? []).map((id) => ds.projects.find((p) => p.id === id)!).filter(Boolean);
    // lastmod is the newest CMS change among the jobs the page shows; a page with no recorded change carries none (a rebuild changes no page's content)
    const lastmod = projects.map((p) => p.updatedAt?.slice(0, 10)).filter((d): d is string => !!d).sort().pop();
    const images = page?.type === "project" ? projects[0].photos.map((ph) => `<image:image><image:loc>${esc(imgUrl(ph.file, 1200))}</image:loc><image:caption>${esc(ph.caption)}</image:caption></image:image>`).join("") : "";
    return `<url><loc>${esc(new URL(u, base).toString())}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}${images}</url>`;
  }).join("");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${body}</urlset>`, { headers: { "Content-Type": "application/xml" } });
}
