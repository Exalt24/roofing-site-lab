# Handover: running this for a real roofing company

What the owner or office manager needs to know, and what a developer needs to set up once. Everything about vendors and prices was read on 2026-10-12 and changes; check the vendor page before you rely on a figure.

## Accounts, and who owns them

Create every account under the company's own email, never a contractor's, so the company can remove the contractor at any time.

| Account | Used for | Notes |
|---|---|---|
| Sanity | The place the crew's jobs are entered, reviewed and published | Free plan has two roles only, Administrator and Viewer. A person who publishes is therefore an Administrator and can also change settings. A restricted Editor role needs the Growth plan (about $15 per seat per month). Content Releases is Enterprise only. |
| Cloudflare | Hosts the site (Pages) | Free plan covers a site this size. 500 builds a month; a single file on Pages is limited to 25 MiB, so real project videos belong in Sanity or object storage, not in the site. |
| CallRail | Tracking numbers, call recording, post-call webhook | Paid. The webhook signing key is shown in its settings. Form tracking is on a higher plan; this site posts its own form to the receiver, so it is not needed. |
| Google Analytics 4 and Tag Manager | Traffic and conversions | Free. Accepting Google's terms is the owner's decision and has to be done by the owner. |
| Google Search Console and Bing Webmaster Tools | Search visibility | Free. Verified with a meta tag the site template already supports. |
| Google Ads | Only if they advertise | The offline-conversion upload needs an Ads account and a conversion action. |

## How a job becomes a page

1. The crew picks the photos and fills the short intake (what the roof was like, what was hard, what was installed, the result). In this lab the intake is a file the command reads, there is no staff screen for it yet; a Studio intake document the crew fills in is the first thing to build. Customer names, phone numbers, emails and street addresses go in the separate private block, never in those boxes. The drafter refuses an intake that has them in the free text and says which box.
2. `tools/draft_to_sanity.mjs` runs the drafter and writes a draft in Sanity. A re-run never overwrites a draft someone has edited; delete the draft in Studio to regenerate it.
3. A person reads the draft, fills in what the drafter listed as missing, checks the photos carry the right before, during or after label, confirms the homeowner's photo release and any review consent, and presses Publish. Nothing the AI writes can go live without that.
4. Rebuild and deploy with `tools/deploy_pages.mjs`. Today this is a command. Making Publish trigger the rebuild automatically is not wired, and it needs a decision first: a Cloudflare Pages project made with Direct Upload (as this one is) cannot be switched to Git integration later, and Cloudflare now steers new projects to Workers, so the usual route is a Git-connected Worker with a deploy hook that a Sanity webhook calls (Sanity publishes fire webhooks, drafts do not).

## Setting up the lead receiver (not deployed in this lab)

The receiver is a small Node program, `packages/tracking/src/server.ts`, run with `npm run start -w packages/tracking`. It needs a host that stays on and keeps a disk (the ledger is a SQLite file), with Node 22.18 or newer. Settings are environment variables, listed at the top of that file. Point CallRail's post-call webhook at `/callrail/post-call` and the website form at `/api/lead` (set `PUBLIC_LEAD_ENDPOINT` when building the site, otherwise the form is shown as not connected). Set `TRUST_PROXY=1` only when it sits behind a proxy that overwrites the client address. Set `ALLOW_ORIGIN` to the site's address whenever the site and the receiver are on different addresses: without it the lead is stored but the visitor's browser cannot read the reply, so the form shows an error. Set `NOTIFY_WEBHOOK_URL` for new-lead notifications. CallRail does not resend a failed webhook and may disable a webhook that keeps failing, so the receiver needs a host that stays up and an alert when it does not. The receiver deletes leads older than 24 months every day, which is what the privacy page promises; CallRail keeps recordings, call logs and form submissions for 25 months, its backups can hold deleted data for up to 90 more days, and it may keep caller contact details while the account is open unless you ask it to delete them (CallRail's retention page), and anything already sent to Google or to the notification address is outside that purge, which is why the privacy page says so.

Before the first recorded call: set up CallRail's caller greeting so every caller hears that the call is recorded and why, and that a scrambled copy of their number may be sent to Google to measure advertising (the privacy page promises both), then ring the tracking number and listen to it. Canadian guidance (the federal Privacy Commissioner) says to tell the caller the call is recorded and why, and to offer a choice, which the unrecorded number in the footer provides. The sample form's consent wording, the privacy page and the greeting are the three places that have to agree.

## A second brand

One brand is one Sanity project, one Cloudflare Pages project and one set of settings, all from the same code. Create the Sanity project and the Pages project for the new brand, set `SANITY_PROJECT_ID`, `SANITY_TOKEN`, `PAGES_PROJECT` and the Cloudflare variables for it (see `tools/_env.mjs`), edit the business document and the neighbourhoods in its Studio, and run the deploy. Two brands never share content or logins this way, which is the point: a person with access to one cannot see the other. It has not been demonstrated here with a second brand.

## Before the first real customer

- A lawyer reads the privacy page and the consent wording. They are a starting point built from BC's PIPA, CASL and Google's policies, not legal advice.
- Replace the sample company, jobs, photos, licence and insurance details, and the placeholder phone number. Every one of them is invented.
- Check each published photo for people, house numbers and licence plates, and get the written photo release for each job.
- Google Ads side, if they advertise: the conversion action the uploads go to must be of the type "Import from clicks" (website, UPLOAD_CLICKS), the customer data terms must be accepted and enhanced conversions for leads turned on, or the uploads fail. Withdrawing someone's advertising consent is `node --experimental-sqlite packages/tracking/src/withdraw.ts <ledger.sqlite> <lead id>`.
- Photo releases: the sample stores only a yes or no. A real company needs who agreed, when and the signed document kept somewhere it can find, and a way to take a photo down, because a published photo stays in caches and in the dataset history.
- Sanity's free plan has public datasets only: whatever is published (text, photos, video) is readable by anyone, and a draft stays private only until it is published. Photos entered through the Studio instead of the drafter are not stripped of metadata by this code; strip them on upload (or check a phone photo for GPS) before a house location is published.
- Google Business Profile is the main source of calls for a local roofer and is not part of this lab: set it up with the same name, address and phone as the site, and decide before launch whether the real number or a tracking number is the primary on it (a tracking number as primary breaks consistency; the real one loses call data).
- Captions: real crew videos will have speech, and a video with speech needs captions or a transcript; the sample clips are silent. The local AI model assumes an office machine that can run a 14 billion parameter model (the evaluation ran on a developer GPU machine), so a real company needs that hardware or the hosted option, and the cost table does not include it.
- Google side, more: send the estimate-booked and the sold-job events to two different conversion actions (both stages go to one action in this code, so with a count of every both would add up). Google Analytics runs before any choice; for visitors in the EEA, UK or Switzerland that needs Google Consent Mode with a default of denied for those regions, or the site should not be offered there. A phone-call lead has no withdrawal command: a caller's consent rests on the greeting. One receiver process per ledger file: the same-call check reads then inserts without a lock, so two receivers writing one file can store a call twice. GA4 will not take an event whose last visit was more than 63 days ago for advertising export; the builder does not check that.
- Decide what the quote form says about ad measurement: it has its own unticked box, and without it the receiver keeps only what the person typed. A lawyer should read that wording with the privacy page.
- Connect Tag Manager and a real CallRail account, then walk through [VERIFY.md](VERIFY.md) with a real call.

## What this lab did not do

No live CallRail account or Google Ads account was connected. GA4, Tag Manager, Search Console and Bing are connected to the sample site on a test Google account (see the README register). The nightly CallRail reconcile is written from CallRail's published API reference and has not been run against an account. The hosted Sanity Studio and the site are samples.
