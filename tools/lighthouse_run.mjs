// Run Lighthouse (mobile, simulated throttling, the default profile) against URLs through a Playwright-launched Chromium, print the scores and the vitals, save the JSON under qa/lighthouse/.
//   node tools/lighthouse_run.mjs <url> [<url> ...] [--label name]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import lighthouse from "lighthouse";

const { chromium } = createRequire(import.meta.url)("playwright");
const args = process.argv.slice(2);
const label = args.includes("--label") ? args[args.indexOf("--label") + 1] : "run";
const urls = args.filter((a, i) => a.startsWith("http") && args[i - 1] !== "--label");
const out = path.resolve(import.meta.dirname, "..", "qa", "lighthouse");
fs.mkdirSync(out, { recursive: true });
const PORT = 9341;
const browser = await chromium.launch({ headless: true, args: [`--remote-debugging-port=${PORT}`] });
try {
  for (const url of urls) {
    const r = await lighthouse(url, { port: PORT, output: "json", logLevel: "error", onlyCategories: ["performance", "accessibility", "best-practices", "seo"] });
    const j = JSON.parse(r.report);
    const slug = (label + "_" + new URL(url).pathname.replace(/\W+/g, "_")).replace(/_+$/, "");
    fs.writeFileSync(path.join(out, slug + ".json"), r.report);
    const a = j.audits;
    const sc = (k) => Math.round(j.categories[k].score * 100);
    console.log(JSON.stringify({ url, lighthouse: j.lighthouseVersion, performance: sc("performance"), accessibility: sc("accessibility"), bestPractices: sc("best-practices"), seo: sc("seo"),
      LCP_ms: Math.round(a["largest-contentful-paint"].numericValue), CLS: +a["cumulative-layout-shift"].numericValue.toFixed(3), TBT_ms: Math.round(a["total-blocking-time"].numericValue), FCP_ms: Math.round(a["first-contentful-paint"].numericValue),
      transferKB: Math.round(a["total-byte-weight"].numericValue / 1024), scripts: a["network-requests"].details.items.filter((x) => x.resourceType === "Script").length }));
  }
} finally { await browser.close(); }
