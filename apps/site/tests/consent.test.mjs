// LIFESPAN: permanent
// Consent Mode v2: the default is denied for all four signals and runs before Tag Manager, the update follows the measurement box, and the order is checked on the BUILT pages, with a swapped order as the control.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONSENT_SIGNALS, consentDefaultSnippet, consentUpdateSnippet, consentComesFirst } from "../src/lib/consent.ts";

const site = fileURLToPath(new URL("..", import.meta.url));
const astro = fileURLToPath(new URL("../../../node_modules/astro/bin/astro.mjs", import.meta.url));
const out = join(site, "dist-consent");
const env = { ...process.env, SITE_URL: "https://seabreeze-roofing.example", PUBLIC_GTM_ID: "GTM-TEST123" };
delete env.PUBLIC_LEAD_ENDPOINT; delete env.PUBLIC_NOINDEX;
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
let pages = [];

before(() => {
  execFileSync(process.execPath, [astro, "build", "--outDir", "dist-consent"], { cwd: site, stdio: "pipe", env });
  pages = walk(out).filter((f) => f.endsWith(".html")).map((f) => ({ file: f.slice(out.length), html: readFileSync(f, "utf8") }));
});

test("the default denies all four signals and asks Tag Manager to wait for an update", () => {
  const s = consentDefaultSnippet();
  for (const sig of CONSENT_SIGNALS) assert.ok(s.includes(`${sig}:'denied'`), sig);
  assert.ok(!s.includes("granted"));
  assert.match(s, /wait_for_update:500/);
});

test("the update grants all four when ticked and denies all four when unticked, and refuses an unsafe field name", () => {
  const s = consentUpdateSnippet("measurement_opt_in");
  const [, grant, deny] = s.match(/b\.checked\?\{([^}]*)\}:\{([^}]*)\}/);
  for (const sig of CONSENT_SIGNALS) { assert.ok(grant.includes(`${sig}:'granted'`)); assert.ok(deny.includes(`${sig}:'denied'`)); }
  for (const bad of ["a'b", "x\"y", "", "ab", "has space", "x;alert(1)"]) assert.throws(() => consentUpdateSnippet(bad), /unsafe/);
});

test("every built page that loads Tag Manager sets the consent default before it, with every signal denied", () => {
  const withGtm = pages.filter((p) => p.html.includes("googletagmanager.com/gtm.js"));
  assert.ok(withGtm.length >= 5, `only ${withGtm.length} pages load Tag Manager`);
  const bad = withGtm.filter((p) => !consentComesFirst(p.html)).map((p) => p.file);
  assert.deepEqual(bad, []);
});

test("mutation control: a page that loads Tag Manager first, or has a granted default, is read as wrong", () => {
  const good = pages.find((p) => p.html.includes("googletagmanager.com/gtm.js")).html;
  const consent = good.indexOf("gtag('consent','default'");
  const gtm = good.indexOf("googletagmanager.com/gtm.js");
  assert.ok(consentComesFirst(good));
  assert.ok(consent < gtm);
  assert.equal(consentComesFirst(good.replace("gtag('consent','default'", "gtag('consent','xdefault'")), false);
  assert.equal(consentComesFirst(good.replace("googletagmanager.com/gtm.js", "x").replace("</head>", "<script>googletagmanager.com/gtm.js</script></head>").replace(/analytics_storage:'denied'/, "analytics_storage:'granted'")), false);
  const swapped = good.slice(0, consent) + "googletagmanager.com/gtm.js " + good.slice(consent);
  assert.equal(consentComesFirst(swapped.replace(good.slice(gtm, gtm + 28), "x".repeat(28))), false);
});

test("the contact page wires the update to the measurement box", () => {
  const contact = pages.find((p) => p.file.replace(/\\/g, "/").endsWith("contact/index.html"));
  assert.ok(contact.html.includes("gtag('consent','update'"));
  assert.ok(contact.html.includes("measurement_opt_in"));
});
