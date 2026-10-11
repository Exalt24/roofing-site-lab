// Truth checks on the built pages: structured data that stands on its own and carries real dates, an areas page that agrees with the projects page, and dates a homeowner can read.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const site = fileURLToPath(new URL("..", import.meta.url));
const astro = fileURLToPath(new URL("../../../node_modules/astro/bin/astro.mjs", import.meta.url));
const out = join(site, "dist-truth");
const env = { ...process.env, SITE_URL: "https://seabreeze-roofing-lab.example" };
delete env.PUBLIC_LEAD_ENDPOINT; delete env.PUBLIC_NOINDEX;
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
const LD = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
let pages = [];

before(() => {
  execFileSync(process.execPath, [astro, "build", "--outDir", "dist-truth"], { cwd: site, stdio: "pipe", env });
  pages = walk(out).filter((f) => f.endsWith(".html")).map((f) => ({ file: f.slice(out.length).split(String.fromCharCode(92)).join("/"), html: readFileSync(f, "utf8") }));
});

const nodesOf = (html) => [...html.matchAll(LD)].map((m) => JSON.parse(m[1]));
const definedIds = (html) => new Set(nodesOf(html).flatMap((n) => (n["@id"] ? [n["@id"]] : [])));
const referencedIds = (node) => [...JSON.stringify(node).matchAll(/"@id":"([^"]+)"/g)].map((m) => m[1]);

test("structured data stands on its own: no page references an @id that it does not define", () => {
  for (const p of pages) {
    const defined = definedIds(p.html);
    for (const n of nodesOf(p.html)) for (const id of referencedIds(n)) if (!(n["@id"] === id) && !defined.has(id)) assert.fail(`${p.file}: references ${id} but defines nothing by that id`);
  }
});

test("MUTANT: no page claims a date nobody recorded: with fixture data (no CMS dates) there is no datePublished, no dateModified, no VideoObject and no sitemap lastmod", () => {
  const sm = readFileSync(join(out, "sitemap.xml"), "utf8");
  assert.equal(/<lastmod>/.test(sm), false, "a rebuild changes no page, so the sitemap carries no lastmod without a CMS date");
  let articles = 0;
  for (const p of pages) for (const n of nodesOf(p.html)) {
    if (n["@type"] === "Article") { articles++; assert.equal("datePublished" in n, false, p.file); assert.equal("dateModified" in n, false, p.file); assert.equal(n.author["@type"], "RoofingContractor"); }
    assert.notEqual(n["@type"], "VideoObject", p.file + ": a video with no recorded upload date gets no markup");
  }
  assert.ok(articles >= 11);
});

test("MUTANT: the areas page says a neighbourhood with a finished job but no area page has a job, and says plainly which neighbourhood has no finished project at all", () => {
  const a = pages.find((p) => p.file === "/areas/index.html");
  assert.ok(a);
  assert.match(a.html, /Horseshoe Bay has a finished job on the projects page/);
  assert.match(a.html, /Lynn Valley has no finished project to show yet/);
});

test("job dates read as a month and a year, and the business no longer claims a district none of its jobs are in", () => {
  const idx = pages.find((p) => p.file === "/projects/index.html");
  assert.ok(idx);
  assert.match(idx.html, /finished [A-Z][a-z]+ 20\d\d/);
  assert.equal(/finished 20\d\d-\d\d/.test(idx.html), false);
  const home = pages.find((p) => p.file === "/index.html");
  assert.equal(/North Vancouver/.test(home.html), false);
  assert.equal(nodesOf(home.html).some((n) => JSON.stringify(n.areaServed ?? "").includes("North Vancouver")), false);
});

test("the share image is a cropped JPEG preview size, not the original", () => {
  const home = pages.find((p) => p.file === "/index.html");
  const og = /property="og:image" content="([^"]+)"/.exec(home.html);
  assert.ok(og, "home has an og:image");
  assert.ok(og[1].includes("/photos/") || /w=1200&h=630.*fm=jpg/.test(og[1].replace(/&amp;/g, "&")), og[1]);
});
