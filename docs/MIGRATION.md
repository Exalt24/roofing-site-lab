# Moving a site from a site builder onto this one

A site builder such as Duda cannot export its theme or its database, so a move means rebuilding the pages and then telling search engines where each old address went. The redirect map is the part that decides whether the practice keeps its rankings. This page covers that map and the checklist around it.

## The redirect map

1. **Collect the old addresses.** Crawl the old site or take its sitemap (`/sitemap.xml` on most builders). One URL per line, or the sitemap file itself, goes into `old_urls.txt`.
2. **Build the new site first.** The tool matches old addresses to pages that exist, so the new pages come before the map.
3. **Run the tool.**

```sh
node --experimental-strip-types tools/redirect_map.mjs \
  --old old_urls.txt --pages apps/site/dist \
  --overrides overrides.json --out apps/site/public/_redirects --report report.md
```

4. **Read `report.md`.** Every old address ends up in one of three places: redirected, listed as needing a decision, or flagged as a problem. The tool exits 0 only when nothing needs a person.
5. **Decide each listed address.** Put the answer in `overrides.json` (`"/old-path": "/new-path/"`) and run again. An old page with no equivalent is never sent to the home page by the tool, because search engines read that as a soft 404 and it can cost more than a clean 404. If a page has no equivalent, let it 404, or point it at the nearest real page by writing that override on purpose.
6. **Check an existing file** (the tool also reads `_redirects` files written by hand): `node --experimental-strip-types tools/redirect_map.mjs --check apps/site/public/_redirects --pages apps/site/dist`.

`docs/migration-sample/` holds a made-up crawl, its overrides, the generated `_redirects` and the report.

## What the tool refuses, and why

| Problem | Why it matters |
|---|---|
| A redirect that is not a 301 | Cloudflare's default is 302, a temporary move that does not carry rankings across. The tool writes the 301 on every line. |
| A source that is also a live page | Redirects are followed even when a page matches, so the live page would become unreachable. |
| A target that is not a page of the new site | The old address would land on a 404. |
| A chain or a loop | A chain costs a hop and some link strength, and a loop never lands. |
| The same source twice | Only the first rule applies, so a second target is silently ignored. |
| A query string or fragment in a source | Cloudflare cannot match a query string and never evaluates a fragment, so the rule would never fire. |
| More than 2,000 static or 100 dynamic rules, or a line over 1,000 characters | The limits of a `_redirects` file; the surplus goes into Bulk Redirects. |
| A line that is not `[source] [destination] [code?]` | Cloudflare skips it without a warning. |
| Only the letter case differs | Whether the host treats the two as one address is not something the tool can know, so a person checks. |

These come from Cloudflare's Pages redirects page, read on 2026-10-25 (`https://developers.cloudflare.com/pages/configuration/redirects/`): "A _redirects file is limited to 2,000 static redirects and 100 dynamic redirects, for a combined total of 2,100 redirects. Each redirect declaration has a 1,000-character limit." and "Redirects are always followed, regardless of whether or not an asset matches the incoming request." and "302 is used as the default status code."

## Known limits

An independent pass tried to break the tool. What it found and the tool now handles: an encoded space in an old address (Cloudflare skips that line without a warning, so the tool now refuses it and reads its own output back), a sitemap index given as input (refused, pass the child sitemaps), a folder page listed as `/team/index.html` (the `/team` and `/team/` spellings get the rule too), the pairs matched only by the last part of the address (listed in the report to read by eye), and targets that leave the site (listed, not checked). What is left, on purpose:

- A wildcard rule in a hand-written file is not tested against the live pages, so `/* /about/ 301` passes `--check`. Read hand-written wildcards yourself.
- An override target without a trailing slash costs a second hop (a 301 then a 308); write targets with the slash.
- Query strings are dropped before matching, so `/shop?id=2` and `/shop?id=3` count as one address, and fragment-only addresses (`#!about`) collapse into their page. Where the old site told pages apart by query string, write each in the overrides file.
- A sitemap URL wrapped in CDATA is dropped, and `&apos;` stays literal.
- A line with no scheme, such as `www.old.example/services`, is read as a path, and an external link left in the list can become a rule; keep the list to the old site's own pages.
- A byte order mark at the start of the overrides file stops the tool with a raw error.
- Two rules are written for each old address, so a list over about 1,000 addresses reaches the 2,000 rule limit.
- A rule matches only the spelling the old crawl listed, case included, so a lowercase inbound link to an address the old site listed in mixed case 404s if the old host ignored case. List each spelling you want covered.
- An address with a literal percent sign (`/100%25-guarantee`) is decoded to `/100%-guarantee`, which a browser never requests; write that rule by hand. An override for an address with a space cannot clear the space warning, because the rule needs the address as written; give such an address an encoded-free override by hand.
- A sitemap given as the new site's pages leaves out live pages that are not listed (a thank-you page), so a rule could hide one; pass the built site folder instead (the tool prints a note when you pass a sitemap).
- Production Cloudflare was not tested, only its local Pages runtime, which served `/ABOUT/` with a 200, so whether asset paths are case sensitive there is unknown.

## Before the cutover

- [ ] Every old address is redirected or deliberately left to 404 (`report.md` shows none waiting).
- [ ] Titles, descriptions, headings and image alt text copied over for each page that ranks.
- [ ] Forms posted a test entry to the right inbox, and a spam check is on.
- [ ] Analytics, Tag Manager and call tracking fire on the staging site.
- [ ] A staging copy is not indexed (`PUBLIC_NOINDEX=true`).
- [ ] DNS time to live lowered a day ahead so the switch takes minutes, not hours.
- [ ] The old site's backup and the list of its integrations are saved.

## Cutover day

- [ ] Publish the new site with the `_redirects` file in the build output.
- [ ] Switch DNS and confirm the certificate is issued.
- [ ] Open twenty old addresses, including the home page and the top landing pages, and confirm each lands on the right page with a 301.

## After the cutover

- [ ] Search Console: verify the new site, submit the sitemap, and watch the Pages report for new "not found" addresses over the next weeks.
- [ ] Compare impressions and clicks to the weeks before the move and chase any page that dropped.
- [ ] Keep the redirects for at least a year.
- [ ] Hand the owner the editing guide and the list of accounts.
