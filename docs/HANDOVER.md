# Handover: running this for a real roofing company

What the owner or office manager needs to know, and what a developer needs to set up once. Everything about vendors and prices was read on 2026-10-12 and changes; check the vendor page before you rely on a figure.

## Accounts, and who owns them

Create every account under the company's own email, never a contractor's, so the company can remove the contractor at any time.

| Account | Used for | Notes |
|---|---|---|
| Sanity | The place the crew's jobs are entered, reviewed and published | Free plan has two roles only, Administrator and Viewer. A person who publishes is therefore an Administrator and can also change settings. A restricted Editor role needs the Growth plan (about $15 per seat per month). Content Releases is Enterprise only. |
| Cloudflare | Hosts the site (Pages) | Free plan covers a site this size. 500 builds a month, shared across all sites in the account. |
| CallRail | Tracking numbers, call recording, post-call webhook | Paid. The webhook signing key is shown in its settings. |
| Google Analytics 4 and Tag Manager | Traffic and conversions | Free. Accepting Google's terms is the owner's decision and has to be done by the owner. |
| Google Search Console and Bing Webmaster Tools | Search visibility | Free. Verified with a meta tag the site template already supports. |
| Google Ads | Only if they advertise | The offline-conversion upload needs an Ads account and a conversion action. |

## How a job becomes a page

1. The crew picks the photos and fills the short intake (what the roof was like, what was hard, what was installed, the result). Customer names, phone numbers, emails and street addresses go in the separate private block, never in those boxes. The drafter refuses an intake that has them in the free text and says which box.
2. `tools/draft_to_sanity.mjs` runs the drafter and writes a draft in Sanity. A re-run never overwrites a draft someone has edited; delete the draft in Studio to regenerate it.
3. A person reads the draft, fills in what the drafter listed as missing, checks the photos carry the right before, during or after label, confirms the homeowner's photo release and any review consent, and presses Publish. Nothing the AI writes can go live without that.
4. Rebuild and deploy with `tools/deploy_pages.mjs`. Today this is a command. Making Publish trigger the rebuild automatically is not wired.

## Setting up the lead receiver (not deployed in this lab)

The receiver is a small Node program, `packages/tracking/src/server.ts`, run with `npm run start -w packages/tracking`. It needs a host that stays on and keeps a disk (the ledger is a SQLite file), with Node 22.18 or newer. Settings are environment variables, listed at the top of that file. Point CallRail's post-call webhook at `/callrail/post-call` and the website form at `/api/lead` (set `PUBLIC_LEAD_ENDPOINT` when building the site, otherwise the form is shown as not connected). Set `TRUST_PROXY=1` only when it sits behind a proxy that overwrites the client address. Set `NOTIFY_WEBHOOK_URL` for new-lead notifications. The receiver deletes leads older than 24 months every day, which is what the privacy page promises; CallRail deletes its own recordings on its own schedule.

## A second brand

One brand is one Sanity project, one Cloudflare Pages project and one set of settings, all from the same code. Create the Sanity project and the Pages project for the new brand, set `SANITY_PROJECT_ID`, `SANITY_TOKEN`, `PAGES_PROJECT` and the Cloudflare variables for it (see `tools/_env.mjs`), edit the business document and the neighbourhoods in its Studio, and run the deploy. Two brands never share content or logins this way, which is the point: a person with access to one cannot see the other. It has not been demonstrated here with a second brand.

## Before the first real customer

- A lawyer reads the privacy page and the consent wording. They are a starting point built from BC's PIPA, CASL and Google's policies, not legal advice.
- Replace the sample company, jobs, photos, licence and insurance details, and the placeholder phone number. Every one of them is invented.
- Check each published photo for people, house numbers and licence plates, and get the written photo release for each job.
- Connect Tag Manager and a real CallRail account, then walk through [VERIFY.md](VERIFY.md) with a real call.

## What this lab did not do

No live CallRail, Google Ads or GA4 property was connected. The nightly CallRail reconcile is written from CallRail's published API reference and has not been run against an account. The hosted Sanity Studio and the site are samples.
