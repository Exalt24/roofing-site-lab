// What the privacy page and the consent box must say, and how a second ad click is handled, checked on the built pages and in a real browser.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const site = fileURLToPath(new URL("..", import.meta.url));
const astro = fileURLToPath(new URL("../../../node_modules/astro/bin/astro.mjs", import.meta.url));
const out = join(site, "dist-policy");
const PORT = 4412;
const BASE = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, SITE_URL: "https://seabreeze-roofing-lab.example" };
delete env.PUBLIC_LEAD_ENDPOINT; delete env.PUBLIC_NOINDEX;
let server, browser, privacy, contact;

before(async () => {
  execFileSync(process.execPath, [astro, "build", "--outDir", "dist-policy"], { cwd: site, stdio: "pipe", env });
  privacy = readFileSync(join(out, "privacy", "index.html"), "utf8");
  contact = readFileSync(join(out, "contact", "index.html"), "utf8");
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".xml": "application/xml", ".svg": "image/svg+xml" };
  server = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, BASE).pathname);
    if (p.endsWith("/")) p += "index.html";
    const file = join(out, p);
    if (!file.startsWith(out) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); server?.closeAllConnections(); server?.close(); });

test("the privacy page has the sections the BC Commissioner suggests, names the Google Ads sharing and the real CallRail retention, and does not claim more than it does", () => {
  for (const h of ["Who is responsible", "What we collect and why", "Consent", "Phone calls", "Who handles it for us", "Sharing for advertising measurement", "Cookies and advertising", "How long we keep it", "Safeguards", "Your access and corrections", "Complaints"]) assert.match(privacy, new RegExp(`<h2[^>]*>${h}</h2>`), h);
  assert.match(privacy, /hashed/);
  assert.match(privacy, /25 months/);
  assert.match(privacy, /90 days/);
  assert.match(privacy, /oipc\.bc\.ca/);
  assert.equal(/follows the headings/.test(privacy), false, "organised under suggested headings, not claiming to follow a mandatory list");
});

test("the marketing consent box names the sender, gives a mailing address and says how to withdraw, as a CASL consent request must, and is never pre-ticked", () => {
  const label = /<label class="check">([\s\S]*?)<\/label>/.exec(contact);
  assert.ok(label);
  const box = label[1].replace(/<[^>]+>/g, "");
  assert.match(box, /Ltd/);
  assert.match(box, /\d{2,5} [A-Z]/, "a street address");
  assert.match(box, /@/, "a contact address");
  assert.match(box, /withdraw/i);
  assert.equal(/checked/.test(label[1]), false);
});

test("MUTANT: ad measurement has its own unticked box that says it is optional and does not affect the quote, and the privacy page says nothing but the quote is a condition of the quote", () => {
  const m = /<label class="check"><input type="checkbox" name="measurement_opt_in"[^>]*>([\s\S]*?)<\/label>/.exec(contact);
  assert.ok(m, "a measurement box exists");
  assert.equal(/checked/.test(m[0]), false, "never pre-ticked");
  const text = m[1].replace(/<[^>]+>/g, "");
  assert.match(text, /optional/i);
  assert.match(text, /does not affect my quote/i);
  assert.match(text, /hashed/);
  assert.match(privacy, /Nothing else is a condition of getting a quote/);
  assert.match(privacy, /only if you tick the separate advertising box/i);
  assert.equal(/By sending the quote form you agree to us using what you typed for the purposes above/.test(privacy), false, "the old bundled sentence is gone");
});

test("required fields are marked", () => {
  assert.match(contact, /Fields marked \* are required/);
  assert.match(contact, /Your name \*/);
  assert.match(contact, /Phone \*/);
});

test("MUTANT: a new ad click that lands directly on the contact page replaces the earlier click's campaign, landing page and click time instead of mixing with them", async () => {
  const page = await browser.newPage();
  await page.goto(BASE + "/projects/ambleside-standing-seam-hillside/?gclid=FIRST&utm_source=google&utm_campaign=one", { waitUntil: "load" });
  const t1 = await page.evaluate(() => sessionStorage.getItem("lab_click_time"));
  await new Promise((r) => setTimeout(r, 30));
  const second = BASE + "/contact/?gclid=SECOND&utm_campaign=two";
  await page.goto(second, { waitUntil: "load" });
  const v = (n) => page.locator(`#lead-form [name=${n}]`).inputValue();
  assert.equal(await v("gclid"), "SECOND");
  assert.equal(await v("utm_campaign"), "two");
  assert.equal(await v("utm_source"), "", "the first click's source is gone");
  assert.equal(await v("landing_page"), second, "the landing page is the new click's page");
  assert.notEqual(await v("click_time"), t1, "the click time is the new click's");
  await page.close();
});

test("a second, different ad click in the same tab replaces the first one's click id, campaign, landing page and click time", async () => {
  const page = await browser.newPage();
  const first = BASE + "/projects/ambleside-standing-seam-hillside/?gclid=FIRST&utm_campaign=one";
  const second = BASE + "/services/?gclid=SECOND&utm_campaign=two";
  await page.goto(first, { waitUntil: "load" });
  const t1 = await page.evaluate(() => sessionStorage.getItem("lab_click_time"));
  await new Promise((r) => setTimeout(r, 30));
  await page.goto(second, { waitUntil: "load" });
  await page.goto(BASE + "/contact/", { waitUntil: "load" });
  const v = (n) => page.locator(`#lead-form [name=${n}]`).inputValue();
  assert.equal(await v("gclid"), "SECOND");
  assert.equal(await v("utm_campaign"), "two");
  assert.equal(await v("landing_page"), second, "the landing page agrees with the click id");
  assert.ok(Date.parse(await v("click_time")) > Date.parse(t1), "the click time moved with the click");
  await page.close();
});

test("the same click id seen again keeps its original click time and landing page", async () => {
  const page = await browser.newPage();
  const landing = BASE + "/areas/?gclid=SAME";
  await page.goto(landing, { waitUntil: "load" });
  const t1 = await page.evaluate(() => sessionStorage.getItem("lab_click_time"));
  await new Promise((r) => setTimeout(r, 30));
  await page.goto(BASE + "/projects/?gclid=SAME", { waitUntil: "load" });
  await page.goto(BASE + "/contact/", { waitUntil: "load" });
  assert.equal(await page.locator("#lead-form [name=click_time]").inputValue(), t1);
  assert.equal(await page.locator("#lead-form [name=landing_page]").inputValue(), landing);
  await page.close();
});
