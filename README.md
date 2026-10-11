# Roofing Site Lab

![Review screens in the Studio, then the generated site](docs/demo.gif)

*Left to right in the clip: an AI-written draft waiting for a person in Sanity Studio, then the live static site that is built from the same content. [Full quality mp4](docs/demo.mp4).*

A working reference for a roofing contractor's website, built to show how the content, the speed, the AI-assisted drafting and the call tracking fit together. Live site: https://seabreeze-roofing-lab.pages.dev

**Everything here is sample data.** "Seabreeze Roofing & Solar" is an invented company, the jobs, people, reviews, licence and insurance details, phone number and addresses are made up, and every photograph is a synthetic image generated locally (SDXL through ComfyUI) with its metadata stripped. The clips are 6 second synthetic placeholders. Nothing is a real customer, a real roof or a real result. **The quote form on the live sample is not connected to anything** (the page says so and the button is disabled): the lead receiver is built and tested here but is not deployed.

For the person who would run this for a real company, start with [docs/HANDOVER.md](docs/HANDOVER.md).

## What it does

A roofer's crew finishes a job, picks the photos and fills a short intake (what the roof was like, what was hard, what was installed). The system turns that into a draft project page in Sanity Studio. A person reads it, fixes it and presses Publish. The site is rebuilt as static HTML from the published content.

- **Content model, one entry per job.** A completed project is entered once. Service, material and neighbourhood pages are derived from the projects, so they cannot drift apart. A neighbourhood page only exists when it has at least 2 finished projects and at least 25 words of local facts; otherwise the page is not generated and the build log says why.
- **Build gates.** The build refuses to ship when the page graph breaks: orphan pages, dead links, an area page that could be swapped for another area by changing the place name (swap test), or near-duplicate pages. Each gate has a test that fails when the gate is removed.
- **AI drafting with a human in the loop.** The model writes only structured JSON against a schema, from a facts ledger with ids. Each section has to cite the entered facts it used (citation is per section, not per sentence). Deterministic validators then check numbers, names, materials, banned claims, personal data, lengths, near-duplicates and a prompt-injection canary. Missing details are computed in code and shown as "missing information" rather than invented. The writer can only create `drafts.*` documents, so nothing the model writes can go live without a person, and a re-run never overwrites a draft someone has edited.
- **What the AI step receives.** The job's entered fields, the staff notes and photo captions, and the photos. The private block (customer name, phone, email, street address) is never sent. If an employee types one of those into a free-text box anyway, the intake is refused before any model call and the message names the box. Uploaded photos have their EXIF (GPS, device, time) removed first. The default model runs locally through Ollama, so nothing leaves the machine; a hosted model is an option the company would have to choose.
- **Call tracking plumbing.** A webhook receiver for CallRail's post-call format (HMAC-SHA1 `Signature` header, checked against the RFC 2202 test vector), E.164 phone normalisation, click ids pulled from the landing page URL, a SQLite ledger with idempotent inserts that stores only an allow-list of fields, an outbox with backoff, a daily retention purge, and a nightly reconcile because CallRail does not resend failed webhooks. `npm run start -w packages/tracking` runs it. Output goes to GA4 (Measurement Protocol) and to Google Ads through the **Data Manager API**, because new offline-conversion work can no longer use the Google Ads API upload route (restricted from 2026-06-15). The Ads builder measures click age to the day of the upload, drops a click id older than 90 days, stops matching on phone and email after 63, and builds requests with `validateOnly` on by default.
- **Site.** Astro 7, static output, images from Sanity's CDN with `auto=format`, JSON-LD for the business, articles, videos and breadcrumbs. No FAQ markup and no self-written review stars (Google ended FAQ rich results and ignores a business's reviews of itself). Credentials bar on every page, consented customer reviews shown on the page, before / during / after photo labels, a one-tap call and quote bar on phones, a skip link, a 404 page, share tags, a privacy page, and a quote form that states its purpose.
- **Privacy built in.** The quote form stores the version of the privacy notice the person saw and keeps marketing email as a separate, unticked box. A review only renders when its consent flag is true. Published images are checked for metadata. This follows BC's PIPA, CASL and Google's own policies as read on 2026-10-12; it is not legal advice.

## Honest register (what has and has not been run)

| Part | Status |
|---|---|
| Content graph and build gates | 12 tests, mutation-checked |
| Drafter and validators | 42 tests. Evaluation on a local model (`qwen3:14b`, with `qwen3.5:9b` describing photos): 13 cases, 14 model calls. 2 adversarial cases that have a customer's details typed into the notes are refused before any model call, which is the intended result. Of the other 11, all 11 reached "ready for review", 8 on the first attempt and 3 on the second (`packages/drafter/evals/results/`). The same 13 cases scored 13 of 13 ready, 10 on the first attempt, before the intake screen existed |
| Draft written into Sanity from an intake | Run end to end against the hosted Studio (`tools/draft_to_sanity.mjs`) for one job; the screens in the clip are that draft |
| Call tracking receiver, ledger and builders | 33 tests, including signature, replay, idempotency, reconcile, click-id and phone/email age limits, consent storage, header injection, retention and the runnable server; run against recorded-shape payloads, **not against a live CallRail account**. The nightly CallRail reconcile request follows CallRail's published API reference and has **not** been run against an account |
| GA4 payloads | Accepted by Google's own validation server (`tools/validate_ga4_payload.mjs`), which also rejects a bad payload, so a clean run means something |
| Google Ads payloads | Built to the Data Manager API's documented shape; **never sent**, there is no Ads account behind this lab |
| CallRail number swapping | Built against CallRail's documented behaviour and tested with a **simulator** (`apps/site/public/callrail-sim.js`) that is not CallRail's code and is not deployed with the live site: the `noswap` attribute, the "All Except Direct & Organic" pool, no automatic rescan. 8 tests |
| Site structure | 7 tests on the built HTML of all 35 pages: one H1, no skipped heading levels, skip link, share tags, credentials, JSON-LD parses, honest contact form, 404, and a Tag Manager id with script text in it is ignored. 3 more check image metadata |
| Google Analytics, Tag Manager, Search Console, Bing | The page template takes the ids from environment variables (`PUBLIC_GTM_ID`, `PUBLIC_GSC_TOKEN`, `PUBLIC_BING_TOKEN`); none are connected on the live sample |
| Hosted site and Studio | Cloudflare Pages (`tools/deploy_pages.mjs`) and a hosted Sanity Studio |
| Total | 105 tests across four packages |

Known limit of the drafter: the validators check facts, numbers and names, not meaning. A summary can still say "replacing" when the intake never said anything was replaced. That is why a person publishes.

How to check each tracking step, and the failures that happen silently: [docs/VERIFY.md](docs/VERIFY.md).

CallRail's own integrations overlap with this ledger: its GA4 events cannot fill GA4's standard source, medium, campaign or gclid fields and do not appear in Google Ads reporting inside GA4, and CallRail recommends its direct Google Ads integration for call conversions. So in production the ledger owns the new part (estimate booked, job sold) and uses distinct event names so nothing is counted twice.

## Speed

Lighthouse 13.5.0, mobile profile with simulated throttling, run against the live site on 2026-10-12, no analytics or call-tracking scripts loaded (so these are the floor, and adding a tag manager and a swap script will cost something). Across six pages (home, a project, an area, contact, services, privacy) Accessibility, Best Practices and SEO were all 100. Performance and the largest paint:

| Page | Performance | LCP | CLS | TBT |
|---|---|---|---|---|
| Home (4 runs) | 100, 100, 99, and 90 on the first request after a deploy while the image CDN cache was cold | 1.8 s to 2.1 s warm, 2.8 s cold | 0 | 0 ms |
| Project page (standing seam on a hillside) | 100 | 1.3 s | 0 | 0 ms |
| Area page | 98 | 2.2 s | 0 | 0 ms |
| Contact, services, privacy | 100 | 1.1 s to 1.3 s | 0 | 0 ms |

Re-run with `node tools/lighthouse_run.mjs <url>`; reports are not committed.

## What it costs (ESTIMATE)

My arithmetic from the vendors' published pricing, read 2026-10-12, for about 3,000 visits a month and about 10 times that. Assumptions: about 3% of visits call, 3 minutes a call, about 15 GA4 events a visit, 25 tracking numbers in the pool at the larger size.

| Item | About 3,000 visits a month | About 30,000 visits a month |
|---|---|---|
| Sanity (free plan: 2 roles, 250K API requests, 1M CDN requests, 100 GB bandwidth) | $0. A restricted Editor role needs the Growth plan at $15 per seat. | $0 on the free plan if a visit loads 1 MB or less (30 GB at 1 MB a visit, against 100 GB included) |
| Cloudflare Pages (free: 500 builds a month, static requests free) | $0 | $0 |
| GA4 and Tag Manager | $0 (BigQuery export free cap is 1 million events a day) | $0 |
| CallRail | about $51 to $56 (Lead Tracking from $50 to $55 with 5 numbers and 250 minutes; 90 calls is 270 minutes, so 20 extra minutes at $0.06) | about $260 (90 calls becomes 900, 2,700 minutes, 2,450 over the included 250 at $0.06 is $147, plus $50 to $55 base, plus 20 extra numbers at $3) |
| **Total** | **about $51 to $56 a month** | **about $260 a month, almost all CallRail** |

What bites first on the free tiers: Cloudflare's 500 builds a month if every publish triggers a rebuild, so batch publishes into one build every few minutes, and never poll CallRail's API when webhooks and one nightly reconcile will do.

## Run it

Needs Node 22.18 or newer (the tests run TypeScript directly) and, for the site tests, a Chromium for Playwright.

```sh
npm install
npx playwright install chromium
npm test                      # 105 tests across four packages
npm run build                 # builds from fixtures when no Sanity project id is set
```

GitHub Actions runs the same commands on every push.

Optional pieces, none needed for the commands above:

- **Drafting locally.** Install [Ollama](https://ollama.com) and pull `qwen3:14b` (the drafting model) and `qwen3.5:9b` (describes photos). `node tools/draft_to_sanity.mjs 1` then writes a draft for the first test job into your Sanity project. A hosted-model backend is written (`packages/drafter/src/llm.ts`, needs `OPENROUTER_API_KEY`) but has not been run.
- **Image metadata.** `pip install pillow`, then `python tools/strip_image_metadata.py` before committing photos. Uploads made by the drafter are cleaned in code.
- **Receiver.** `npm run start -w packages/tracking` with `CALLRAIL_SIGNING_KEY` and `OWNER_EMAIL` set; the other settings are listed at the top of `packages/tracking/src/server.ts`.

### Run it against your own accounts

The tools that talk to Sanity and Cloudflare read `SANITY_PROJECT_ID`, `SANITY_TOKEN` (an Editor token), optional `SANITY_DATASET`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and `PAGES_PROJECT` from the environment, or from a `KEY=VALUE` file named by `SECRETS_FILE` (`tools/_env.mjs`). Then:

```sh
node --experimental-strip-types tools/seed_sanity.mjs     # put the sample content into your Sanity project
cd studio && npm run deploy                          # your own Studio, after replacing the ids in sanity.cli.ts (studio/README.md)
node tools/deploy_pages.mjs                               # build from Sanity and deploy to your own Pages project
```

Set `PUBLIC_LEAD_ENDPOINT` when building to connect the quote form to a receiver, and `PUBLIC_NOINDEX=true` for a staging site you do not want searched.

## Layout

```
packages/content    the content model, page graph and build gates
packages/drafter    intake -> facts ledger -> structured draft -> validators -> Sanity drafts
packages/tracking   call webhook receiver and server, ledger, outbox, reconcile, GA4 and Data Manager API builders
apps/site           Astro site and the CallRail swap simulator
studio              Sanity Studio schema
docs                HANDOVER.md (running it for a real company), VERIFY.md (how to check the tracking), demo clip
tools               seeding, deploy, Lighthouse, screenshots, GA4 payload validation, image metadata
```

## Licence

MIT. The sample photographs and text are synthetic and carry no rights claim.
