# How to know the tracking works

A tracking set-up fails quietly: Google's Measurement Protocol does not return an error for a malformed event, and a conversion upload that cannot be matched just reads as "ads are not working". So each step below has an expected result, and the first two can be run from this repo today. Sources are Google's and CallRail's own documentation, read 2026-10-12.

| # | Check | How | Expected |
|---|---|---|---|
| 1 | Our GA4 payloads are well formed | `node --experimental-strip-types --experimental-sqlite tools/validate_ga4_payload.mjs` | Every payload comes back with no `validationMessages` from `google-analytics.com/debug/mp/collect`. The validation server does not check the API secret and nothing it receives reaches a report. |
| 2 | The check can fail | send `{"client_id":"1.2","validation_behavior":"ENFORCE_RECOMMENDATIONS","events":[{"name":"bad name"}]}` to the same endpoint | A `NAME_INVALID` message comes back (and with no `client_id`, `VALUE_REQUIRED`), so a clean run in step 1 means something. Note that the default RELAXED mode misses an old timestamp or a mistyped `session_id`; the tool asks for ENFORCE_RECOMMENDATIONS so it catches those. |
| 3 | The tag fires | Tag Manager Preview (Tag Assistant), or watch the requests in a browser | The GA4, CallRail and click-to-call tags show as fired. Note GA4 batches events, so a tap can reach the collect endpoint several seconds late, and it is sent when the page is left. |
| 4 | GA4 receives events | GA4 DebugView (needs debug mode, and consent blocks it if Consent Mode is on) and Realtime | The test event shows within seconds. Standard reports take 24 to 48 hours. |
| 5 | A real call reaches the ledger | Call a tracking number from a browser that landed with `?gclid=test` | A row appears in the lead ledger with the click id and source. CallRail may take up to 20 minutes to attach a recording or transcript before it fires the post-call webhook. |
| 6 | The number swap works on a tracked visit and not on an organic one | Open the site with `?utm_source=google&utm_medium=cpc`, then with no parameters | Header number is the tracking number in the first and the real number in the second. The footer number never swaps (`data-calltrk-noswap`). |
| 7 | Google Ads accepts the upload | Build the request with `adsIngestRequest(...)` (it defaults to `validateOnly: true`) and send it to the Data Manager API `ingest` method | A `requestId` and no `fieldWarnings`. Then set `validateOnly` to false, wait at least 3 hours (up to 72 for gbraid and wbraid) and read the offline data diagnostics page. |
| 8 | Nothing is counted twice | CallRail's own GA4 integration already sends calls and forms as events, and can post its own Google Ads call conversion | Our GA4 events are `generate_lead`, `qualify_lead` and `close_convert_lead` and our Ads conversions are the estimate and sold stages, none of which collide with the names CallRail sends. |

## Silent failures worth a monitor

- **The click id has expired.** A click id is kept 90 days, and a conversion matched on phone or email is only imported within 63. A roof is often sold weeks after the first click. For a quote-form lead the ledger records the time the visitor first arrived from an ad (the layout script stores it on the first page they land on, and the form sends it as `click_time`); for a call it only has the call time, because CallRail's post-call payload carries no click time, so a call's age is measured from the call and understates how old the click is. `adsIngestEvent` refuses an expired one with a reason, and `leadsNearingClickExpiry` lists leads still waiting at 56 days or more. Data already sent to a notification webhook is outside the 24 month purge.
- **The click id was never captured.** Safari's link-tracking protection can remove tracking parameters from a URL; WebKit does not publish the list, so test the real landing page in Safari with all browsing protected. Store the click id on first landing in a first-party script.
- **The old upload route.** New work cannot use the Google Ads API `UploadClickConversions` method (restricted from 2026-06-15). This repo builds Data Manager API requests only.
- **A custom-event trigger that never matches.** Importing a Tag Manager container with Overwrite can disable the built-in Event variable, and every Custom Event trigger then silently stops firing while the dataLayer push still shows in the page. Found on this sample: the `click_to_call` push was there and GA4 received nothing until the Event variable was enabled again (`docs/gtm-container.json` includes it).
- **Numbers not swapping.** CallRail alerts when a number has not swapped for several days (its help article says 3, a 2025 community post says the default is 5) and runs a daily snippet check; turn those emails on.

## What is not verified here

Nothing in this repo has been run against a live CallRail account or a live Google Ads account. GA4 and Tag Manager are live on the sample site (check 4 was done in Realtime, from a real browser). The simulator in `apps/site/public/callrail-sim.js` reproduces CallRail's documented swap behaviour and is not CallRail's code.
