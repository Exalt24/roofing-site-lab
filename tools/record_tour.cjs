// Record a real scroll tour of the deployed site (Playwright video), for the README GIF.
//   node tools/record_tour.cjs <outDir>
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const BASE = "https://seabreeze-roofing-lab.pages.dev";
const out = path.resolve(process.argv[2]);
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: out, size: { width: 1280, height: 720 } } });
  const page = await ctx.newPage();
  const scroll = async (px, steps = 8) => { for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, px / steps); await page.waitForTimeout(160); } };
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  await scroll(700);
  await page.waitForTimeout(500);
  await page.getByRole("link", { name: /projects/i }).first().click();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(700);
  await scroll(500);
  await page.locator("a[href^='/projects/']:not([href='/projects/'])").first().click();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);
  await scroll(900, 10);
  await page.waitForTimeout(500);
  await scroll(900, 10);
  await page.waitForTimeout(700);
  const area = page.locator("a[href^='/areas/']").first();
  if (await area.count()) { await area.click(); await page.waitForLoadState("networkidle"); await page.waitForTimeout(900); await scroll(600); await page.waitForTimeout(500); }
  await ctx.close();
  await browser.close();
  console.log(fs.readdirSync(out));
})();
