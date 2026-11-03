Tag Manager container versions for the sample site.

The container is kept as an export in `docs/gtm-container.json`, so a change to it is a reviewed diff. `apps/site/tests/gtm-container.test.mjs` fails when a tag fires on a missing trigger, reads a missing variable, shares a name with another tag, or does not wait for analytics consent.

| Version | State | What changed |
|---|---|---|
| 3 | Published in the test container | Google tag plus the click_to_call and generate_lead GA4 event tags |
| 4 | In this repo, not yet imported or published | Every tag now waits for analytics consent, matching the Consent Mode default the site sets before Tag Manager loads |

To publish version 4: in Tag Manager choose Admin, Import Container, pick `docs/gtm-container.json`, merge into the existing workspace, then Preview, check the consent states in the debug panel, and Submit.

Not covered: server-side tagging. It needs a hosted server container, which this sample does not run.
