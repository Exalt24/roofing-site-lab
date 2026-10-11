// Structural checks on the built HTML of every page: one H1, no skipped heading levels, share tags, a skip link, credentials on every page, valid JSON-LD, an honest contact form, and a 404 page.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const site = fileURLToPath(new URL("..", import.meta.url));
const astro = fileURLToPath(new URL("../../../node_modules/astro/bin/astro.mjs", import.meta.url));
const out = join(site, "dist-pages");
const env = { ...process.env, SITE_URL: "https://seabreeze-roofing.example" };
delete env.PUBLIC_LEAD_ENDPOINT; delete env.PUBLIC_NOINDEX;

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
let pages = [];

before(() => {
  execFileSync(process.execPath, [astro, "build", "--outDir", "dist-pages"], { cwd: site, stdio: "pipe", env });
  pages = walk(out).filter((f) => f.endsWith(".html")).map((f) => ({ file: f.slice(out.length), html: readFileSync(f, "utf8") }));
});

const headingLevels = (html) => [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));

test("every page has exactly one H1 and never skips a heading level", () => {
  assert.ok(pages.length >= 30, `expected the whole site, found ${pages.length} pages`);
  for (const p of pages) {
    const levels = headingLevels(p.html);
    assert.equal(levels.filter((l) => l === 1).length, 1, `${p.file}: needs exactly one h1`);
    let top = 0;
    for (const l of levels) { assert.ok(l <= top + 1, `${p.file}: h${l} follows h${top}`); top = Math.max(top, l); }
    // a deeper heading may come back up (h3 then h2); the check above only forbids jumping down more than one level from the deepest seen
  }
});

test("every page carries a skip link, share tags, a canonical address and the credentials bar", () => {
  for (const p of pages) {
    assert.match(p.html, /href="#main"/, `${p.file}: skip link`);
    assert.match(p.html, /rel="canonical"/, `${p.file}: canonical`);
    assert.match(p.html, /property="og:title"/, `${p.file}: og:title`);
    assert.match(p.html, /name="twitter:card"/, `${p.file}: twitter card`);
    assert.match(p.html, /class="trust/, `${p.file}: credentials bar`);
  }
  const project = pages.find((p) => p.file.includes("projects") && p.html.includes('property="og:image"'));
  assert.ok(project, "project pages share their first photo");
});

test("JSON-LD parses on every page and never contains a raw less-than sign", () => {
  let count = 0;
  for (const p of pages) for (const m of p.html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    count++;
    assert.equal(m[1].includes("<"), false, `${p.file}: raw < inside JSON-LD`);
    JSON.parse(m[1]);
  }
  assert.ok(count >= 30, "the pages carry structured data");
});

test("with no receiver configured the contact form says so, and its button is disabled", () => {
  const c = pages.find((p) => p.file.includes("contact"));
  assert.ok(c);
  assert.match(c.html, /not connected to a lead receiver/);
  assert.match(c.html, /<button[^>]*disabled/);
  assert.match(c.html, /name="submission_id"/);
});

test("there is a 404 page, marked noindex, with a way back, and it is not in the sitemap", () => {
  const f = join(out, "404.html");
  assert.ok(existsSync(f), "a 404.html makes Cloudflare Pages return a real 404 for unknown addresses");
  const html = readFileSync(f, "utf8");
  assert.match(html, /name="robots" content="noindex"/);
  assert.match(html, /href="\/projects\/"/);
  assert.equal(readFileSync(join(out, "sitemap.xml"), "utf8").includes("404"), false);
});

test("a noindex build marks every page noindex", () => {
  execFileSync(process.execPath, [astro, "build", "--outDir", "dist-pages"], { cwd: site, stdio: "pipe", env: { ...env, PUBLIC_NOINDEX: "true" } });
  const files = walk(out).filter((f) => f.endsWith(".html"));
  assert.ok(files.length >= 30 && statSync(files[0]).size > 0);
  for (const f of files) assert.match(readFileSync(f, "utf8"), /name="robots" content="noindex"/, f);
});

test("MUTANT: a Tag Manager id or script address with script text in it is ignored, a well-formed one is used", () => {
  const home = () => readFileSync(join(out, "index.html"), "utf8");
  const build = (extra) => execFileSync(process.execPath, [astro, "build", "--outDir", "dist-pages"], { cwd: site, stdio: "pipe", env: { ...env, ...extra } });
  build({ PUBLIC_GTM_ID: "GTM-X');alert(1);//", PUBLIC_CALLRAIL_SCRIPT: "https://x.example/a.js');alert(2);//" });
  assert.equal(/alert\(/.test(home()), false);
  assert.equal(home().includes("googletagmanager"), false);
  build({ PUBLIC_GTM_ID: "GTM-ABC1234", PUBLIC_CALLRAIL_SCRIPT: "//cdn.callrail.com/companies/1/abc/12/swap.js" });
  assert.match(home(), /googletagmanager\.com\/gtm\.js/); assert.match(home(), /GTM-ABC1234/); assert.match(home(), /cdn\.callrail\.com\/companies\/1\/abc\/12\/swap\.js/);
});

test("the built site ships security response headers, and its images, scripts and styles stay free to load", () => {
  const f = join(out, "_headers");
  assert.ok(existsSync(f), "a _headers file makes Cloudflare Pages send them");
  const h = readFileSync(f, "utf8");
  for (const name of ["X-Content-Type-Options: nosniff", "Referrer-Policy:", "Permissions-Policy:", "Strict-Transport-Security:", "frame-ancestors 'none'"]) assert.ok(h.includes(name), name);
  assert.equal(/script-src|default-src/.test(h), false, "a script policy would need testing against Tag Manager before it ships");
});
