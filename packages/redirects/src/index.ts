// Redirect map for a site migration: old URLs in, a Cloudflare Pages `_redirects` file out, and a checker that refuses a map that would hurt the move.
// Facts about the file format are from Cloudflare's Pages redirects page (docs/MIGRATION.md quotes each one): the default status is 302, so a 301 is always written out;
// a file holds at most 2,000 static and 100 dynamic redirects and each line at most 1,000 characters; a source cannot carry a query string and a fragment in a source is never evaluated;
// redirects are followed even when an asset matches the request, so a source that is also a live page makes that page unreachable.

export const MAX_STATIC = 2000;
export const MAX_DYNAMIC = 100;
export const MAX_LINE = 1000;

export type How = "exact" | "override" | "slug" | "index";
export interface Entry { from: string; to: string; status: number; how: How }
export interface OldUrl { raw: string; path: string; spelled: string; hadQuery: boolean }
export interface Unmatched { from: string; reason: "no-page" | "ambiguous" | "case-differs"; candidates: string[] }
export interface MapResult { entries: Entry[]; unmatched: Unmatched[] }
export type ProblemKind = "SOURCE_IS_LIVE_PAGE" | "TARGET_MISSING" | "CHAIN" | "LOOP" | "DUPLICATE_SOURCE" | "SELF_REDIRECT" | "QUERY_IN_SOURCE" | "FRAGMENT_IN_SOURCE" | "NOT_301" | "TOO_MANY_STATIC" | "TOO_MANY_DYNAMIC" | "LINE_TOO_LONG" | "BAD_LINE" | "EXTERNAL_TARGET";
export interface Problem { kind: ProblemKind; from: string; message: string }

const isDynamic = (p: string) => p.includes("*") || /:[A-Za-z]\w*/.test(p);
const isExternal = (s: string) => /^[a-z][a-z0-9+.-]*:/i.test(s);

/** A comparable path: no scheme or host, no query or fragment, one leading slash, collapsed slashes, no index.html, no trailing slash except the root. */
export function normalizePath(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  if (isExternal(s) || s.startsWith("//")) {
    try { s = new URL(s.startsWith("//") ? "https:" + s : s).pathname; } catch { return null; }
  }
  s = s.split("#")[0].split("?")[0];
  try { s = decodeURI(s); } catch { /* keep as written */ }
  s = s.replace(/\/{2,}/g, "/");
  if (!s.startsWith("/")) s = "/" + s;
  s = s.replace(/\/index\.html?$/i, "/").replace(/\.html?$/i, "");
  if (s.length > 1) s = s.replace(/\/+$/, "");
  return s;
}

/** The address as the old site spelled it: query and fragment dropped, slashes collapsed, no trailing slash, but the case and any .html ending kept, since a rule matches the spelling a visitor typed. */
export function spelledPath(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  if (isExternal(s) || s.startsWith("//")) {
    try { s = new URL(s.startsWith("//") ? "https:" + s : s).pathname; } catch { return null; }
  }
  s = s.split("#")[0].split("?")[0];
  try { s = decodeURI(s); } catch { /* keep as written */ }
  s = s.replace(/\/{2,}/g, "/");
  if (!s.startsWith("/")) s = "/" + s;
  return s.length > 1 ? s.replace(/\/+$/, "") : s;
}

// Compare addresses as the host serves them: no query or fragment, no trailing slash, lower case, and the .html ending kept.
const plain = (p: string) => (spelledPath(p) ?? p).toLowerCase();
const hasExtension = (p: string) => /\.html?$/i.test(p);

/** Old URLs from a plain list (one per line, # comments) or a sitemap (every <loc>). A query string is noted and dropped: Cloudflare cannot match one. */
export function parseOldUrls(text: string): { urls: OldUrl[]; ignored: string[] } {
  const ignored: string[] = [];
  const raws = /<loc>/i.test(text)
    ? [...text.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, "&"))
    : text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const seen = new Set<string>();
  const urls: OldUrl[] = [];
  for (const raw of raws) {
    const path = normalizePath(raw);
    const spelled = spelledPath(raw);
    if (path === null || spelled === null) { ignored.push(raw); continue; }
    const key = spelled.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push({ raw, path, spelled, hadQuery: raw.includes("?") });
  }
  return { urls, ignored };
}

const lastSegment = (p: string) => p.split("/").filter(Boolean).pop()?.toLowerCase() ?? "";

/**
 * Match each old URL to a page of the new site: an override the owner wrote, then the same path, then a unique page with the same last segment.
 * An old URL with no safe match is listed as unmatched. It is never sent to the home page, because a search engine reads that as a soft 404.
 */
export function buildMap(oldUrls: OldUrl[], newPages: string[], overrides: Record<string, string> = {}, opts: { trailingSlash?: boolean } = {}): MapResult {
  // Cloudflare Pages serves a folder page at `/x/` and answers `/x` with a 308 to it, so a target written without the slash costs a second hop.
  const served = (p: string) => (opts.trailingSlash === false || p === "/" ? p : p + "/");
  // A rule matches one spelling only: `/x` and `/x/` are different sources, so a spelling with no extension gets both.
  const rules = (o: OldUrl, to: string, how: How): Entry[] => {
    const out: Entry[] = [{ from: o.spelled, to, status: 301, how }];
    if (!hasExtension(o.spelled) && o.spelled !== "/") out.push({ from: o.spelled + "/", to, status: 301, how });
    return out;
  };
  const live = new Map<string, string>();
  for (const p of newPages) { const n = normalizePath(p); if (n) live.set(n.toLowerCase(), n); }
  const bySegment = new Map<string, string[]>();
  for (const n of live.values()) { const seg = lastSegment(n); if (seg) bySegment.set(seg, [...(bySegment.get(seg) ?? []), n]); }
  const ov = new Map<string, string>();
  for (const [k, v] of Object.entries(overrides)) { const nk = normalizePath(k); if (nk) ov.set(nk.toLowerCase(), v); }
  const entries: Entry[] = [];
  const unmatched: Unmatched[] = [];
  for (const o of oldUrls) {
    const key = o.path.toLowerCase();
    const ovTo = ov.get(key);
    if (ovTo !== undefined) { entries.push(...rules(o, ovTo, "override")); continue; }
    const exact = live.get(key);
    if (exact !== undefined) {
      // The same address exists on the new site and needs no redirect. When only the case differs, whether the host treats the two as one address is not something this tool can know, so a person decides.
      if (o.spelled === exact) continue;
      if (o.spelled.toLowerCase() === exact.toLowerCase()) { unmatched.push({ from: o.path, reason: "case-differs", candidates: [exact] }); continue; }
      // The old address ended in .html or /index.html: the page exists, but that spelling would 404 without a rule.
      entries.push(...rules(o, served(exact), "exact"));
      continue;
    }
    const cands = bySegment.get(lastSegment(o.path)) ?? [];
    if (cands.length === 1) { entries.push(...rules(o, served(cands[0]), "slug")); continue; }
    unmatched.push({ from: o.path, reason: cands.length > 1 ? "ambiguous" : "no-page", candidates: cands });
  }
  return { entries, unmatched };
}

/** The file Cloudflare reads: a comment header, then static redirects, then dynamic ones, each with its status written out. */
export function renderRedirects(entries: Entry[], header = "Redirects from the old site. Generated by tools/redirect_map.mjs, edit the overrides file instead."): string {
  const line = (e: Entry) => `${e.from} ${e.to} ${e.status}`;
  const stat = entries.filter((e) => !isDynamic(e.from));
  const dyn = entries.filter((e) => isDynamic(e.from));
  return [`# ${header}`, ...stat.map(line), ...dyn.map(line)].join("\n") + "\n";
}

/** Read a `_redirects` file back into entries; a line that is not `[source] [destination] [code?]` comes back as a problem, since Cloudflare skips it. */
export function parseRedirects(text: string): { entries: Entry[]; problems: Problem[] } {
  const entries: Entry[] = [];
  const problems: Problem[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim();
    if (!l || l.startsWith("#")) continue;
    const parts = l.split(/\s+/);
    if (parts.length < 2 || parts.length > 3 || (parts[2] !== undefined && !/^\d{3}$/.test(parts[2]))) {
      problems.push({ kind: "BAD_LINE", from: parts[0] ?? l, message: `Cloudflare skips this line: ${l.slice(0, 80)}` });
      continue;
    }
    entries.push({ from: parts[0], to: parts[1], status: parts[2] ? Number(parts[2]) : 302, how: "override" });
  }
  return { entries, problems };
}

/** Everything that would hurt a migration if the map shipped as it is. An empty list means the map is safe to publish. */
export function checkRedirects(entries: Entry[], livePages: string[], opts: { allowExternal?: boolean } = {}): Problem[] {
  const out: Problem[] = [];
  const live = new Set(livePages.map((p) => normalizePath(p)).filter((p): p is string => p !== null).map((p) => p.toLowerCase()));
  const first = new Map<string, Entry>();
  const allSources = new Set(entries.map((e) => plain(e.from)));
  const judged = new Set<string>();
  let stat = 0;
  let dyn = 0;
  for (const e of entries) {
    const dynamic = isDynamic(e.from);
    if (dynamic) dyn++; else stat++;
    const len = `${e.from} ${e.to} ${e.status}`.length;
    if (len > MAX_LINE) out.push({ kind: "LINE_TOO_LONG", from: e.from, message: `${len} characters, the limit is ${MAX_LINE}` });
    if (e.status !== 301) out.push({ kind: "NOT_301", from: e.from, message: `status ${e.status}, and a move that keeps rankings is a 301` });
    if (e.from.includes("?")) out.push({ kind: "QUERY_IN_SOURCE", from: e.from, message: "a source cannot match a query string" });
    if (e.from.includes("#")) out.push({ kind: "FRAGMENT_IN_SOURCE", from: e.from, message: "a fragment in a source is never evaluated" });
    const key = e.from.toLowerCase();
    const prev = first.get(key);
    if (prev) out.push({ kind: "DUPLICATE_SOURCE", from: e.from, message: prev.to === e.to ? "listed twice" : `two targets (${prev.to} and ${e.to}), only the first applies` });
    else first.set(key, e);
    if (!dynamic && live.has(plain(e.from))) out.push({ kind: "SOURCE_IS_LIVE_PAGE", from: e.from, message: "a live page of the new site, which a redirect would hide" });
    if (isExternal(e.to)) {
      if (!opts.allowExternal) out.push({ kind: "EXTERNAL_TARGET", from: e.from, message: `points off the site: ${e.to}` });
      continue;
    }
    if (dynamic || e.to.includes(":") || e.to.includes("*") || judged.has(plain(e.from))) continue;
    judged.add(plain(e.from));
    const target = plain(e.to);
    if (target === plain(e.from)) out.push({ kind: "SELF_REDIRECT", from: e.from, message: "redirects to itself" });
    else if (!live.has(target) && !allSources.has(target)) out.push({ kind: "TARGET_MISSING", from: e.from, message: `${e.to} is not a page of the new site` });
  }
  if (stat > MAX_STATIC) out.push({ kind: "TOO_MANY_STATIC", from: "(file)", message: `${stat} static redirects, the limit is ${MAX_STATIC}; use Bulk Redirects for the rest` });
  if (dyn > MAX_DYNAMIC) out.push({ kind: "TOO_MANY_DYNAMIC", from: "(file)", message: `${dyn} dynamic redirects, the limit is ${MAX_DYNAMIC}` });
  // Chains and loops: follow each static source until it lands on a page, a dead end or a repeat.
  const next = new Map<string, string>();
  for (const e of entries) {
    if (isDynamic(e.from) || isExternal(e.to) || next.has(plain(e.from))) continue;
    next.set(plain(e.from), plain(e.to));
  }
  const reported = new Set<string>();
  for (const e of entries) {
    if (isDynamic(e.from) || reported.has(plain(e.from))) continue;
    reported.add(plain(e.from));
    let at = plain(e.from);
    const seen = new Set<string>([at]);
    let hops = 0;
    let looped = false;
    while (next.has(at)) {
      at = next.get(at)!;
      hops++;
      if (seen.has(at)) { looped = true; break; }
      seen.add(at);
    }
    if (looped) { if (hops > 1) out.push({ kind: "LOOP", from: e.from, message: "the redirects lead back to where they started" }); }
    else if (hops > 1) out.push({ kind: "CHAIN", from: e.from, message: `${hops} hops, point it straight at the final page` });
  }
  return out;
}

/** The whole step the tool runs: parse, match, check, render. Unmatched URLs and problems are both reported, never hidden. */
export function planMigration(oldText: string, newPages: string[], overrides: Record<string, string> = {}) {
  const { urls, ignored } = parseOldUrls(oldText);
  const map = buildMap(urls, newPages, overrides);
  const problems = checkRedirects(map.entries, newPages, { allowExternal: true });
  return { urls, entries: map.entries, unmatched: map.unmatched, ignored, queryOnly: urls.filter((u) => u.hadQuery).map((u) => u.path), problems, file: renderRedirects(map.entries) };
}
