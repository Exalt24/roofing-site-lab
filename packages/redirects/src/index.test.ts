import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePath, parseOldUrls, buildMap, renderRedirects, parseRedirects, checkRedirects, planMigration, MAX_STATIC, MAX_DYNAMIC, MAX_LINE, type Entry } from "./index.ts";

const NEW = ["/", "/services/", "/services/braces/", "/services/invisalign/", "/about/", "/contact/", "/blog/first-visit/", "/blog/braces-care/", "/team/dr-lee/"];
const e = (from: string, to: string, status = 301): Entry => ({ from, to, status, how: "override" });
const kinds = (entries: Entry[], pages = NEW) => checkRedirects(entries, pages).map((p) => p.kind);

test("normalizePath reduces every spelling of an address to one", () => {
  assert.equal(normalizePath("https://www.old-practice.com/Services/Braces/?utm=x#top"), "/Services/Braces");
  assert.equal(normalizePath("//old.example/about-us.html"), "/about-us");
  assert.equal(normalizePath("/about//us/"), "/about/us");
  assert.equal(normalizePath("/index.html"), "/");
  assert.equal(normalizePath("/blog/index.htm"), "/blog");
  assert.equal(normalizePath("contact"), "/contact");
  assert.equal(normalizePath("   "), null);
  assert.equal(normalizePath("https://"), null);
});

test("parseOldUrls reads a plain list and a sitemap, drops duplicates and notes query strings", () => {
  const list = parseOldUrls("# the crawl\nhttps://old.example/about-us\n/about-us/\n\n/blog/post?id=4\nhttps://\n");
  assert.deepEqual(list.urls.map((u) => u.path), ["/about-us", "/blog/post"]);
  assert.equal(list.urls[1].hadQuery, true);
  assert.deepEqual(list.ignored, ["https://"]);
  const map = parseOldUrls("<urlset><url><loc>https://old.example/a?x=1&amp;y=2</loc></url><url><loc> https://old.example/b </loc></url></urlset>");
  assert.deepEqual(map.urls.map((u) => u.path), ["/a", "/b"]);
  assert.equal(map.urls[0].hadQuery, true);
});

test("an old address that still exists on the new site needs no redirect", () => {
  const { entries, unmatched } = buildMap(parseOldUrls("/about\n/contact/\n/").urls, NEW);
  assert.deepEqual(entries, []);
  assert.deepEqual(unmatched, []);
});

test("an old home page with no home page on the new site is listed, not dropped", () => {
  const { entries, unmatched } = buildMap(parseOldUrls("/").urls, NEW.filter((p) => p !== "/"));
  assert.deepEqual(entries, []);
  assert.deepEqual(unmatched.map((u) => [u.from, u.reason]), [["/", "no-page"]]);
});

test("an address that differs only in case is handed to a person, never turned into a redirect to itself", () => {
  const { entries, unmatched } = buildMap(parseOldUrls("/Services/Braces\n/ABOUT").urls, NEW);
  assert.deepEqual(entries, []);
  assert.deepEqual(unmatched.map((u) => [u.from, u.reason, u.candidates[0]]), [["/Services/Braces", "case-differs", "/services/braces"], ["/ABOUT", "case-differs", "/about"]]);
});

test("a unique page with the same last segment is matched, and the match says how", () => {
  const { entries, unmatched } = buildMap(parseOldUrls("/our-services/invisalign\n/old-blog/first-visit").urls, NEW);
  assert.deepEqual(entries.filter((x) => !x.from.endsWith("/")).map((x) => [x.from, x.to, x.how]), [["/our-services/invisalign", "/services/invisalign/", "slug"], ["/old-blog/first-visit", "/blog/first-visit/", "slug"]]);
  assert.deepEqual(unmatched, []);
});

test("a rule matches one spelling, so an address with no extension gets its trailing slash twin", () => {
  const { entries } = buildMap(parseOldUrls("/our-services/invisalign").urls, NEW);
  assert.deepEqual(entries.map((x) => x.from), ["/our-services/invisalign", "/our-services/invisalign/"]);
  assert.equal(new Set(entries.map((x) => x.to)).size, 1);
});

test("the target is written the way the host serves the page, with the trailing slash, so the visitor makes one hop", () => {
  const { entries } = buildMap(parseOldUrls("/our-services/invisalign").urls, NEW);
  assert.ok(entries.every((x) => x.to === "/services/invisalign/"));
  assert.equal(buildMap(parseOldUrls("/our-services/invisalign").urls, NEW, {}, { trailingSlash: false }).entries[0].to, "/services/invisalign");
});

test("an old .html address gets its own rule, since the page exists but that spelling would 404", () => {
  const { entries, unmatched } = buildMap(parseOldUrls("/contact.html\n/Index.html\n/about-us.html").urls, NEW, { "/about-us": "/about/" });
  assert.deepEqual(unmatched, []);
  assert.deepEqual(entries.map((x) => [x.from, x.to]), [["/contact.html", "/contact/"], ["/Index.html", "/"], ["/about-us.html", "/about/"]]);
  assert.ok(!entries.some((x) => x.from.endsWith(".html/")), "an .html address has no trailing slash twin");
});

// The class behind the two defects Cloudflare's runtime found (an .html address with no rule, a rule that missed its trailing-slash twin): a rule matches ONE spelling,
// so every spelling the old site listed must be the exact source of some rule. Generated: every ending crossed with every page depth and every case form.
test("every listed spelling of an old address is the exact source of a rule (generated)", () => {
  const depths = ["/old", "/our-services/old", "/a/b/old"];
  const endings = ["", "/", ".html", ".htm", "/index.html", "/index.htm"];
  const cases = [(s: string) => s, (s: string) => s.toUpperCase().replace("/OLD", "/Old")];
  const pages = ["/", "/about/"];
  let checked = 0;
  for (const depth of depths) for (const ending of endings) for (const shape of cases) {
    const listed = shape(depth + ending);
    const spelled = listed.length > 1 ? listed.replace(/\/+$/, "") : listed;
    const { entries, unmatched } = buildMap(parseOldUrls(listed).urls, pages, { [depth]: "/about/" });
    const sources = new Set(entries.map((x) => x.from));
    assert.ok(sources.has(spelled), `no rule for the spelling ${listed} (rules: ${[...sources].join(", ")}) unmatched: ${JSON.stringify(unmatched)}`);
    if (!/\.html?$/i.test(spelled)) assert.ok(sources.has(spelled + "/"), `no trailing slash twin for ${listed}`);
    for (const x of entries) assert.equal(x.to, "/about/", "every rule lands on the served form of the page");
    checked++;
  }
  assert.equal(checked, depths.length * endings.length * cases.length);
});

test("the source keeps the spelling the old site used, case included", () => {
  const { entries } = buildMap(parseOldUrls("/Our-Services/Invisalign").urls, NEW);
  assert.equal(entries[0].from, "/Our-Services/Invisalign");
});

test("an old address with no safe match is listed and never sent to the home page", () => {
  const { entries, unmatched } = buildMap(parseOldUrls("/promo/summer-special\n/team/dr-lee-old").urls, NEW);
  assert.deepEqual(entries, []);
  assert.deepEqual(unmatched.map((u) => [u.from, u.reason]), [["/promo/summer-special", "no-page"], ["/team/dr-lee-old", "no-page"]]);
  assert.ok(!entries.some((x) => x.to === "/"));
});

test("two pages with the same last segment make the match ambiguous instead of a guess", () => {
  const pages = [...NEW, "/blog/braces", "/services/braces-care"];
  const { entries, unmatched } = buildMap(parseOldUrls("/old/braces-care").urls, pages);
  assert.deepEqual(entries, []);
  assert.equal(unmatched.length, 1);
  assert.equal(unmatched[0].reason, "ambiguous");
  assert.deepEqual(unmatched[0].candidates.sort(), ["/blog/braces-care", "/services/braces-care"]);
});

test("an override the owner wrote wins over every automatic match", () => {
  const { entries } = buildMap(parseOldUrls("/our-services/invisalign\n/promo/summer-special").urls, NEW, { "/our-services/invisalign": "/services/", "/promo/summer-special/": "/contact/" });
  assert.deepEqual(entries.filter((x) => !x.from.endsWith("/")).map((x) => [x.from, x.to, x.how]), [["/our-services/invisalign", "/services/", "override"], ["/promo/summer-special", "/contact/", "override"]]);
});

test("the rendered file writes the 301 on every line, static rules before dynamic ones", () => {
  const text = renderRedirects([e("/blog/*", "/blog/:splat"), e("/a", "/about"), e("/b", "/contact")]);
  const lines = text.trim().split("\n");
  assert.ok(lines[0].startsWith("# "));
  assert.deepEqual(lines.slice(1), ["/a /about 301", "/b /contact 301", "/blog/* /blog/:splat 301"]);
});

test("a file read back gives the same entries, and a line Cloudflare would skip is reported", () => {
  const rendered = renderRedirects([e("/a", "/about"), e("/b", "/contact")]);
  const back = parseRedirects(rendered);
  assert.deepEqual(back.entries.map((x) => [x.from, x.to, x.status]), [["/a", "/about", 301], ["/b", "/contact", 301]]);
  assert.deepEqual(back.problems, []);
  const bad = parseRedirects("/only-one-field\n/a /b 301 extra\n/a /b abc\n/ok /fine 301");
  assert.deepEqual(bad.problems.map((p) => p.kind), ["BAD_LINE", "BAD_LINE", "BAD_LINE"]);
  assert.equal(bad.entries.length, 1);
  assert.equal(parseRedirects("/x /y").entries[0].status, 302, "a line with no code is a 302, Cloudflare's default");
});

test("a clean map passes the check", () => {
  assert.deepEqual(checkRedirects([e("/our-services/invisalign", "/services/invisalign"), e("/old-about", "/about")], NEW), []);
});

test("a 302 is refused because a move that keeps rankings is a 301", () => assert.deepEqual(kinds([e("/old", "/about", 302)]), ["NOT_301"]));
test("a source that is also a live page is refused, since the redirect would hide the page", () => assert.deepEqual(kinds([e("/about", "/contact")]), ["SOURCE_IS_LIVE_PAGE"]));
test("a trailing slash does not hide a live page from the check", () => assert.deepEqual(kinds([e("/about/", "/contact/")]), ["SOURCE_IS_LIVE_PAGE"]));
test("an .html address is not mistaken for the live page of the same name", () => assert.deepEqual(kinds([e("/about.html", "/about/")]), []));
test("two spellings of one page are both kept, because a rule matches one spelling", () => {
  const { urls } = parseOldUrls("/about-us\n/about-us.html\n/about-us/");
  assert.deepEqual(urls.map((u) => u.spelled), ["/about-us", "/about-us.html"]);
});
test("a target that is not a page of the new site is refused", () => assert.deepEqual(kinds([e("/old", "/nowhere")]), ["TARGET_MISSING"]));
test("a redirect to itself is refused", () => assert.deepEqual(kinds([e("/old", "/old/")]), ["SELF_REDIRECT"]));
test("a source with a query string or a fragment is refused", () => {
  assert.deepEqual(kinds([e("/old?id=3", "/about")]), ["QUERY_IN_SOURCE"]);
  assert.deepEqual(kinds([e("/old#team", "/about")]), ["FRAGMENT_IN_SOURCE"]);
});
test("the same source listed twice is refused, with different targets named", () => {
  const p = checkRedirects([e("/old", "/about"), e("/OLD", "/contact")], NEW);
  assert.deepEqual(p.map((x) => x.kind), ["DUPLICATE_SOURCE"]);
  assert.match(p[0].message, /two targets/);
  assert.equal(checkRedirects([e("/old", "/about"), e("/old", "/about")], NEW)[0].message, "listed twice");
});
test("a chain of redirects is refused and a loop is called a loop", () => {
  assert.deepEqual(kinds([e("/a", "/b"), e("/b", "/about")]), ["CHAIN"]);
  assert.deepEqual(kinds([e("/a", "/b"), e("/b", "/c"), e("/c", "/about")]).sort(), ["CHAIN", "CHAIN"]);
  const loop = kinds([e("/a", "/b"), e("/b", "/a")]);
  assert.deepEqual(loop, ["LOOP", "LOOP"]);
});
test("a target defined later in the file is not reported as missing", () => assert.ok(!kinds([e("/a", "/b"), e("/b", "/about")]).includes("TARGET_MISSING")));
test("a dynamic rule is not tested as a page, and a splat target is accepted", () => assert.deepEqual(kinds([e("/old-blog/*", "/blog/:splat")]), []));
test("a target off the site is refused unless the plan allows it", () => {
  assert.deepEqual(kinds([e("/old", "https://elsewhere.example/page")]), ["EXTERNAL_TARGET"]);
  assert.deepEqual(checkRedirects([e("/old", "https://elsewhere.example/page")], NEW, { allowExternal: true }), []);
});
test("the Cloudflare limits are enforced: 2,000 static, 100 dynamic, 1,000 characters a line", () => {
  const many = Array.from({ length: MAX_STATIC + 1 }, (_, i) => e(`/old-${i}`, "/about"));
  assert.ok(checkRedirects(many, NEW).some((p) => p.kind === "TOO_MANY_STATIC"));
  assert.ok(!checkRedirects(many.slice(0, MAX_STATIC), NEW).some((p) => p.kind === "TOO_MANY_STATIC"));
  const dyn = Array.from({ length: MAX_DYNAMIC + 1 }, (_, i) => e(`/d${i}/*`, "/about"));
  assert.ok(checkRedirects(dyn, NEW).some((p) => p.kind === "TOO_MANY_DYNAMIC"));
  assert.ok(!checkRedirects(dyn.slice(0, MAX_DYNAMIC), NEW).some((p) => p.kind === "TOO_MANY_DYNAMIC"));
  const longLine = e("/" + "x".repeat(MAX_LINE), "/about");
  assert.ok(checkRedirects([longLine], NEW).some((p) => p.kind === "LINE_TOO_LONG"));
  assert.ok(!checkRedirects([e("/" + "x".repeat(MAX_LINE - 20), "/about")], NEW).some((p) => p.kind === "LINE_TOO_LONG"));
});

test("planMigration runs the whole step and its file passes its own check", () => {
  const plan = planMigration("https://old.example/our-services/invisalign\nhttps://old.example/promo/summer-special\nhttps://old.example/about\nhttps://old.example/team/dr-lee?x=1", NEW, { "/promo/summer-special": "/contact/" });
  assert.deepEqual(plan.entries.filter((x) => !x.from.endsWith("/")).map((x) => [x.from, x.to]), [["/our-services/invisalign", "/services/invisalign/"], ["/promo/summer-special", "/contact/"]]);
  assert.deepEqual(plan.unmatched, []);
  assert.deepEqual(plan.queryOnly, ["/team/dr-lee"]);
  assert.deepEqual(plan.problems, []);
  const back = parseRedirects(plan.file);
  assert.deepEqual(back.problems, []);
  assert.deepEqual(checkRedirects(back.entries, NEW), []);
});

test("a plan reports a bad override instead of shipping it", () => {
  const plan = planMigration("/old-a\n/old-b", NEW, { "/old-a": "/missing", "/old-b": "/old-a" });
  assert.deepEqual(plan.problems.map((p) => p.kind).sort(), ["CHAIN", "TARGET_MISSING"]);
});
