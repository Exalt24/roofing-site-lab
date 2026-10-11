// A performance budget that fails the build. Serves apps/site/dist (or, with --url, a live site), runs Lighthouse (mobile, simulated throttling) on a few pages and exits 1 when a budget is broken.
//   npm run build && node tools/lighthouse_budget.mjs [--a11y 100] [--tbt 200] [--cls 0.05] [--js-kb 60]        (what the code controls; runs in CI)
//   node tools/lighthouse_budget.mjs --url https://your-site.example [--perf 90] [--lcp 2500] ...                (also performance and LCP, which need the real image CDN)
// The fixture build serves the full-size sample PNGs from disk, so its performance score and LCP say nothing about production and are only checked with --url.
// Pass a deliberately tight budget (for example --a11y 101) to watch it fail; the fixture build ships no script, so --js-kb 0 still passes.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import lighthouse from "lighthouse";

const { chromium } = createRequire(import.meta.url)("playwright");
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i > -1 ? Number(args[i + 1]) : def; };
const urlArg = args.includes("--url") ? args[args.indexOf("--url") + 1].replace(/\/$/, "") : null;
const budget = { perf: opt("perf", 90), a11y: opt("a11y", 100), lcp: opt("lcp", 2500), tbt: opt("tbt", 200), cls: opt("cls", 0.05), jsKb: opt("js-kb", 60) };
const dist = path.resolve(import.meta.dirname, "..", "apps", "site", "dist");
const pages = ["/", "/projects/ambleside-standing-seam-hillside/", "/areas/ambleside/", "/contact/"];
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".xml": "application/xml", ".svg": "image/svg+xml", ".png": "image/png", ".mp4": "video/mp4", ".txt": "text/plain", ".ico": "image/x-icon" };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(dist, p);
  if (!file.startsWith(dist) || !fs.existsSync(file)) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "Content-Type": types[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = urlArg ?? `http://127.0.0.1:${server.address().port}`;
const PORT = 9342;
const browser = await chromium.launch({ headless: true, args: [`--remote-debugging-port=${PORT}`] });
const failures = [];
try {
  for (const p of pages) {
    const r = await lighthouse(base + p, { port: PORT, output: "json", logLevel: "error", onlyCategories: ["performance", "accessibility"] });
    const j = JSON.parse(r.report);
    if (j.runtimeError) { failures.push(`${p}: Lighthouse error ${j.runtimeError.code}`); continue; }
    const perf = Math.round(j.categories.performance.score * 100), a11y = Math.round(j.categories.accessibility.score * 100);
    const cls = +j.audits["cumulative-layout-shift"].numericValue.toFixed(3);
    const lcp = Math.round(j.audits["largest-contentful-paint"].numericValue), tbt = Math.round(j.audits["total-blocking-time"].numericValue);
    const js = Math.round((j.audits["resource-summary"].details.items.find((i) => i.resourceType === "script")?.transferSize ?? 0) / 1024);
    console.log(`${p.padEnd(48)} perf ${perf}  a11y ${a11y}  LCP ${lcp} ms  CLS ${cls}  TBT ${tbt} ms  JS ${js} KB${urlArg ? "" : "  (perf and LCP are not checked on the fixture build)"}`);
    if (urlArg && perf < budget.perf) failures.push(`${p}: performance ${perf} is under ${budget.perf}`);
    if (urlArg && lcp > budget.lcp) failures.push(`${p}: LCP ${lcp} ms is over ${budget.lcp}`);
    if (a11y < budget.a11y) failures.push(`${p}: accessibility ${a11y} is under ${budget.a11y}`);
    if (cls > budget.cls) failures.push(`${p}: CLS ${cls} is over ${budget.cls}`);
    if (tbt > budget.tbt) failures.push(`${p}: TBT ${tbt} ms is over ${budget.tbt}`);
    if (js > budget.jsKb) failures.push(`${p}: ${js} KB of script is over ${budget.jsKb}`);
  }
} finally { await browser.close(); server.close(); }
if (failures.length) { console.error("BUDGET BROKEN:\n" + failures.join("\n")); process.exit(1); }
console.log("budget kept on all pages");
