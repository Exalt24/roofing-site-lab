// DNI and local SEO checks against the built site with the CallRail simulator loaded.
//   npm run test:dni   (builds into dist-sim, serves it, drives it with Playwright)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { join, extname } from "node:path";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const PORT = 4411;
const BASE = `http://127.0.0.1:${PORT}`;
let server, browser;

before(async () => {
  const root = new URL("..", import.meta.url);
  const astro = fileURLToPath(new URL("../../../node_modules/astro/bin/astro.mjs", import.meta.url));
  // the build is the slow part, so it is reused while dist-sim is newer than every source file (npm run test:dni forces a fresh one)
  const dist = fileURLToPath(new URL("../dist-sim/index.html", import.meta.url));
  const newest = (dir) => readdirSync(dir, { withFileTypes: true }).reduce((m, e) => Math.max(m, e.isDirectory() ? newest(join(dir, e.name)) : statSync(join(dir, e.name)).mtimeMs), 0);
  const stale = !existsSync(dist) || statSync(dist).mtimeMs < Math.max(newest(fileURLToPath(new URL("../src", import.meta.url))), newest(fileURLToPath(new URL("../public", import.meta.url))));
  if (stale || process.env.FRESH_BUILD) execFileSync(process.execPath, [astro, "build", "--outDir", "dist-sim"], { cwd: root, stdio: "inherit", env: { ...process.env, PUBLIC_CALLRAIL_SCRIPT: "/callrail-sim.js", SITE_URL: BASE } });
  const dir = fileURLToPath(new URL("../dist-sim/", import.meta.url));
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".xml": "application/xml", ".txt": "text/plain", ".mp4": "video/mp4", ".png": "image/png" };
  server = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, BASE).pathname);
    if (p.endsWith("/")) p += "index.html";
    const file = join(dir, p);
    if (!file.startsWith(dir) || !existsSync(file)) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); server?.closeAllConnections(); server?.close(); });

const headerNumber = (page) => page.locator(".phone .phone-number").innerText();
const footerNumber = (page) => page.locator(".site-footer a[href^='tel:']").first().innerText();

test("the served HTML always carries the real number, in the header, the footer and the JSON-LD, and never the pool number", async () => {
  const html = await (await fetch(BASE + "/")).text();
  assert.match(html, /604 555-0142/);
  assert.match(html, /"telephone":"\+1-604-555-0142"/);
  assert.doesNotMatch(html, /778 555-0190|778-555-0190/);
  assert.equal((html.match(/data-calltrk-noswap/g) ?? []).length >= 1, true);
});

test("a direct visit is untracked: nothing is swapped and the header shows the real number", async () => {
  const page = await browser.newPage();
  await page.goto(BASE + "/", { waitUntil: "load" });
  await page.waitForFunction(() => document.documentElement.getAttribute("data-calltrk-sim"));
  assert.equal(await page.getAttribute("html", "data-calltrk-sim"), "untracked");
  assert.equal(await headerNumber(page), "604 555-0142");
  await page.close();
});

test("a paid visit swaps the header number and its tel link, and leaves the footer and the structured data on the real number", async () => {
  const page = await browser.newPage();
  await page.goto(BASE + "/?gclid=TEST123&utm_source=google&utm_medium=cpc", { waitUntil: "load" });
  await page.waitForFunction(() => document.documentElement.getAttribute("data-calltrk-sim"));
  assert.equal(await page.getAttribute("html", "data-calltrk-sim"), "tracked");
  assert.equal(await headerNumber(page), "778 555-0190");
  assert.equal(await page.locator(".phone").getAttribute("href"), "tel:+1-778-555-0190");
  assert.equal(await footerNumber(page), "604 555-0142");
  assert.equal(await page.locator(".site-footer a[href^='tel:']").first().getAttribute("href"), "tel:+1-604-555-0142");
  const ld = await page.$$eval("script[type='application/ld+json']", (els) => els.map((e) => JSON.parse(e.textContent)));
  assert.equal(ld.find((x) => x["@type"] === "RoofingContractor").telephone, "+1-604-555-0142");
  await page.close();
});

test("a visit from a search engine counts as organic and is not swapped; a referral from another site is", async () => {
  const ctx = await browser.newContext();
  const organic = await ctx.newPage();
  await organic.route("http://www.google.com/**", (r) => r.fulfill({ contentType: "text/html", body: `<a id=go href="${BASE}/">x</a>` }));
  await organic.goto("http://www.google.com/search?q=roofer", { waitUntil: "load" });
  await organic.click("#go");
  await organic.waitForFunction(() => document.documentElement.getAttribute("data-calltrk-sim"));
  assert.equal(await headerNumber(organic), "604 555-0142");
  const ref = await ctx.newPage();
  await ref.route("http://partner.example/**", (r) => r.fulfill({ contentType: "text/html", body: `<a id=go href="${BASE}/">x</a>` }));
  await ref.goto("http://partner.example/links", { waitUntil: "load" });
  await ref.click("#go");
  await ref.waitForFunction(() => document.documentElement.getAttribute("data-calltrk-sim"));
  assert.equal(await headerNumber(ref), "778 555-0190");
  await ctx.close();
});

test("content added after load is NOT swapped until CallTrk.swap() is called (the documented behaviour a client-side router must handle)", async () => {
  const page = await browser.newPage();
  await page.goto(BASE + "/?gclid=TEST123", { waitUntil: "load" });
  await page.waitForFunction(() => document.documentElement.getAttribute("data-calltrk-sim"));
  await page.evaluate(() => { const p = document.createElement("p"); p.id = "late"; p.textContent = "Call 604 555-0142 today"; document.querySelector("main").appendChild(p); });
  assert.match(await page.locator("#late").innerText(), /604 555-0142/);
  await page.evaluate(() => window.CallTrk.swap(document.getElementById("late")));
  assert.match(await page.locator("#late").innerText(), /778 555-0190/);
  await page.close();
});

test("MUTANT: with data-calltrk-noswap removed from the footer the real number would be swapped, so the attribute is what protects it", async () => {
  const page = await browser.newPage();
  await page.goto(BASE + "/?gclid=TEST123", { waitUntil: "load" });
  await page.waitForFunction(() => document.documentElement.getAttribute("data-calltrk-sim"));
  // a fresh paragraph with the real number and no opt-out is swapped; the footer is not, only because of the attribute
  await page.evaluate(() => { const p = document.createElement("p"); p.id = "plain"; p.textContent = "604 555-0142"; document.body.appendChild(p); window.CallTrk.swap(p); });
  assert.match(await page.locator("#plain").innerText(), /778 555-0190/);
  assert.equal(await footerNumber(page), "604 555-0142");
  await page.close();
});

test("a click on a tel link pushes click_to_call to the data layer", async () => {
  const page = await browser.newPage();
  await page.goto(BASE + "/", { waitUntil: "load" });
  await page.evaluate(() => { document.querySelectorAll("a[href^='tel:']").forEach((a) => a.addEventListener("click", (e) => e.preventDefault())); });
  await page.click(".phone");
  const dl = await page.evaluate(() => window.dataLayer);
  assert.ok(dl.some((e) => e.event === "click_to_call" && e.link_location === "header"));
  await page.close();
});

test("the JSON-LD on a project page validates structurally: Article with images, VideoObject with a content url, BreadcrumbList", async () => {
  const page = await browser.newPage();
  await page.goto(BASE + "/projects/british-properties-cedar-replacement/", { waitUntil: "load" });
  const ld = await page.$$eval("script[type='application/ld+json']", (els) => els.map((e) => JSON.parse(e.textContent)));
  const types = ld.map((x) => x["@type"]);
  assert.deepEqual(types.sort(), ["Article", "BreadcrumbList", "VideoObject"]);
  const article = ld.find((x) => x["@type"] === "Article");
  assert.ok(article.image.length >= 2 && article.image.every((i) => i.contentUrl && i.creditText));
  const video = ld.find((x) => x["@type"] === "VideoObject");
  assert.ok(video.contentUrl && video.thumbnailUrl && video.uploadDate && video.duration === "PT6S");
  assert.equal(ld.some((x) => x["@type"] === "FAQPage" || x.aggregateRating), false, "no FAQ markup and no self-review stars");
  await page.close();
});

test("the marketing opt-in checkbox sits on the same row as its label text, at its natural size", async () => {
  for (const [w, h] of [[390, 844], [1280, 800]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.goto(BASE + "/contact/", { waitUntil: "load" });
    const box = await page.locator("label.check input").boundingBox();
    const text = await page.locator("label.check").boundingBox();
    assert.ok(box.width < 30, `checkbox is ${box.width}px wide at ${w}px (a full-width box means the grid rule won)`);
    assert.ok(Math.abs(box.y - text.y) < 20 && box.x < text.x + 40, `checkbox is detached from its label at ${w}px`);
    await page.close();
  }
});
