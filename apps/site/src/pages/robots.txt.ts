// Crawlers are welcome, including the search-side AI crawlers: OAI-SearchBot (ChatGPT search), PerplexityBot and Bingbot, none of which need a special rule.
// Training crawlers (GPTBot and others) are a business decision for the owner and are left at the default (allowed) unless they say otherwise.
import { loadDataset } from "../lib/data.ts";

export async function GET() {
  const ds = await loadDataset();
  return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${new URL("/sitemap.xml", ds.business.url).toString()}\n`, { headers: { "Content-Type": "text/plain" } });
}
