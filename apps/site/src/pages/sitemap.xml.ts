// XML sitemap with image entries. lastmod is real: the newest project date that appears on the page, never "today".
import { buildGraph } from "@lab/content";
import { loadDataset } from "../lib/data.ts";
import { imgUrl } from "../lib/img.ts";
import { BUILD_DATE } from "../lib/dates.ts";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function GET() {
  const ds = await loadDataset();
  const graph = buildGraph(ds);
  const base = ds.business.url;
  const urls = [...graph.pages.map((p) => p.url), "/contact/", "/privacy/"];
  const body = urls.map((u) => {
    const page = graph.pages.find((p) => p.url === u);
    const projects = (page?.projectIds ?? []).map((id) => ds.projects.find((p) => p.id === id)!).filter(Boolean);
    const lastmod = BUILD_DATE; // the pages really were generated today; a job's finish date is not a modification date
    const images = page?.type === "project" ? projects[0].photos.map((ph) => `<image:image><image:loc>${esc(imgUrl(ph.file, 1200))}</image:loc><image:caption>${esc(ph.caption)}</image:caption></image:image>`).join("") : "";
    return `<url><loc>${esc(new URL(u, base).toString())}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}${images}</url>`;
  }).join("");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${body}</urlset>`, { headers: { "Content-Type": "application/xml" } });
}
