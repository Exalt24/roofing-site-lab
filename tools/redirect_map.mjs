// Build the redirect map for a migration and check it.
//   node --experimental-strip-types tools/redirect_map.mjs --old old_urls.txt --pages apps/site/dist --out apps/site/public/_redirects [--overrides overrides.json] [--report report.md]
//   node --experimental-strip-types tools/redirect_map.mjs --check apps/site/public/_redirects --pages apps/site/dist
// --old is a text file with one old URL per line or the old site's sitemap. --pages is the built site (every page folder) or a sitemap.xml.
// Exit 0 only when every old URL is handled and the map has no problem; 1 when something needs a person; 2 on a usage error.
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { planMigration, parseRedirects, checkRedirects, normalizePath, parseOldUrls } from "../packages/redirects/src/index.ts";

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const die = (msg) => { console.error(msg); process.exit(2); };

function pagesFrom(path) {
  if (!existsSync(path)) die(`--pages ${path} does not exist`);
  if (statSync(path).isFile()) return parseOldUrls(readFileSync(path, "utf8")).urls.map((u) => u.path);
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!name.endsWith(".html") || name === "404.html") continue;
      const rel = relative(path, full).split(sep).join("/");
      out.push(normalizePath("/" + rel));
    }
  };
  walk(path);
  return [...new Set(out)];
}

const pagesArg = flag("--pages");
if (!pagesArg) die("--pages is required (the built site folder or its sitemap)");
const pages = pagesFrom(pagesArg);

const checkFile = flag("--check");
if (checkFile) {
  const { entries, problems } = parseRedirects(readFileSync(checkFile, "utf8"));
  const all = [...problems, ...checkRedirects(entries, pages, { allowExternal: true })];
  for (const p of all) console.log(`${p.kind}  ${p.from}  ${p.message}`);
  console.log(all.length ? `${all.length} problem(s) in ${entries.length} redirect(s)` : `OK: ${entries.length} redirect(s), ${pages.length} pages on the new site`);
  process.exit(all.length ? 1 : 0);
}

const oldArg = flag("--old");
if (!oldArg) die("--old is required (a list of old URLs or the old sitemap)");
const overrides = flag("--overrides") ? JSON.parse(readFileSync(flag("--overrides"), "utf8")) : {};
const plan = planMigration(readFileSync(oldArg, "utf8"), pages, overrides);

const lines = [];
lines.push(`# Redirect report`, "", `Old URLs read: ${plan.urls.length}. Pages on the new site: ${pages.length}. Redirects written: ${plan.entries.length}.`, "");
const how = (h) => plan.entries.filter((e) => e.how === h).length;
lines.push(`| How matched | Count |`, `|---|---|`, `| Same address, spelled differently | ${how("exact")} |`, `| Same last part of the address, one page | ${how("slug")} |`, `| Written by the owner | ${how("override")} |`, "");
lines.push(`## Old URLs that need a decision (${plan.unmatched.length})`, "");
if (plan.unmatched.length === 0) lines.push("None.");
for (const u of plan.unmatched) lines.push(`- ${u.from} (${u.reason === "ambiguous" ? "more than one page could match: " + u.candidates.join(", ") : u.reason === "case-differs" ? "only the letter case differs from " + u.candidates[0] + ", so check whether the host treats them as one address" : "no page of the new site matches"})`);
lines.push("", `## Problems (${plan.problems.length})`, "");
if (plan.problems.length === 0) lines.push("None.");
for (const p of plan.problems) lines.push(`- ${p.kind}: ${p.from}, ${p.message}`);
if (plan.queryOnly.length) lines.push("", `## Old URLs that carried a query string (${plan.queryOnly.length})`, "", "Cloudflare cannot match a query string, so these are redirected by their path only: " + plan.queryOnly.join(", "));
if (plan.ignored.length) lines.push("", `## Lines that were not URLs (${plan.ignored.length})`, "", plan.ignored.join(", "));
const report = lines.join("\n") + "\n";

const out = flag("--out");
if (out) writeFileSync(out, plan.file);
else process.stdout.write(plan.file);
if (flag("--report")) writeFileSync(flag("--report"), report); else console.error(report);
process.exit(plan.unmatched.length || plan.problems.length ? 1 : 0);
