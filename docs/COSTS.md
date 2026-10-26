# What it costs (estimate)

My arithmetic from the vendors' published pricing, read 2026-10-12, for about 3,000 visits a month and about 10 times that. Assumptions: about 3% of visits call, 3 minutes a call, about 15 GA4 events a visit, 25 tracking numbers in the pool at the larger size.

| Item | About 3,000 visits a month | About 30,000 visits a month |
|---|---|---|
| Sanity (free plan: 2 roles, 250K API requests, 1M CDN requests, 100 GB bandwidth) | $0. A restricted Editor role needs the Growth plan at $15 per seat. | $0 on the free plan if a visit loads 1 MB or less (30 GB at 1 MB a visit, against 100 GB included) |
| Cloudflare Pages (free: 500 builds a month, static requests free) | $0 | $0 |
| GA4 and Tag Manager | $0 (the BigQuery export limit for standard properties is 1 million events a day) | $0 |
| CallRail | about $51 to $56 (Lead Tracking from $50 to $55 with 5 numbers and 250 minutes; 90 calls is 270 minutes, so 20 extra minutes at $0.06) | about $260 (90 calls becomes 900, 2,700 minutes, 2,450 over the included 250 at $0.06 is $147, plus $50 to $55 base, plus 20 extra numbers at $3) |
| **Total** | **about $51 to $56 a month** | **about $260 a month, almost all CallRail** |

What bites first on the free tiers: Cloudflare Pages' 500 builds a month counts builds Cloudflare runs from a connected Git repository (this repo deploys by direct upload, which it does not count); the Git-connected Worker route HANDOVER recommends is metered in build minutes instead (3,000 a month on its free plan), so either way it only matters if every publish is wired to a rebuild; so batch publishes into one build every few minutes, and never poll CallRail's API when webhooks and one nightly reconcile will do.
