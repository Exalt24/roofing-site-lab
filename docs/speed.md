# Speed

Lighthouse 13.5.0, mobile profile with simulated throttling, run against the live site on 2026-10-12 **with Tag Manager and GA4 loaded**. The CallRail script is not part of the sample, so it is not counted. Across six pages (home, a project, an area, contact, services, privacy) Accessibility, Best Practices and SEO were all 100. Performance and the largest paint:

| Page | Performance | LCP | CLS | TBT | Transferred |
|---|---|---|---|---|---|
| Home | 92 to 100 | 1.8 s to 2.4 s | 0 | 31 to 88 ms | 379 to 392 KB |
| Project page (standing seam on a hillside) | 100 | 0.9 s | 0 | 27 ms | 407 KB |
| Area page | 99 | 2.1 s | 0 | 28 ms | 370 KB |
| Contact, services, privacy | 100 | 1.2 s to 1.3 s | 0 | 56 ms to 58 ms | about 304 KB |

Before Tag Manager was connected, the same pages scored 98 to 100 and moved 4 KB to 109 KB. So the tag costs about 300 KB and under 60 ms of blocking time here.

Two later re-runs on other machines read 98 to 100. Blocking time went up to about 120 ms on the contact and privacy pages. I did not save those two reports, so read the figures as a range. One home-page run right after a deploy scored 90 (LCP 2.8 s) while the image CDN cache was cold. A CallRail swap script will add to this.

Re-run with `node tools/lighthouse_run.mjs <url>`. Reports are not committed.
