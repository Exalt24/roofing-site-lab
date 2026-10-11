// Screenshot a few pages at phone and desktop width and print any console errors or failed requests. Read the PNGs afterwards.
//   node tools/qa_shots.cjs <base url> <out dir> [path ...]
const { chromium } = require("playwright");
const base = process.argv[2];
const out = process.argv[3];
const paths = process.argv.slice(4).length ? process.argv.slice(4) : ["/", "/projects/", "/projects/british-properties-cedar-replacement/", "/areas/ambleside/", "/contact/"];
(async () => {
  const browser = await chromium.launch({ headless: true });
  for (const [name, vp] of [["m390", { width: 390, height: 844 }], ["d1280", { width: 1280, height: 900 }]]) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const problems = [];
    page.on("console", (m) => { if (m.type() === "error") problems.push("console: " + m.text().slice(0, 160)); });
    page.on("requestfailed", (r) => problems.push("failed: " + r.url().slice(0, 120) + " " + (r.failure() || {}).errorText));
    page.on("response", (r) => { if (r.status() >= 400) problems.push(r.status() + " " + r.url().slice(0, 120)); });
    for (const p of paths) {
      await page.goto(base + p, { waitUntil: "load" });
      await page.waitForTimeout(800);
      const file = `${out}/${name}_${(p === "/" ? "home" : p.replace(/\//g, "_").replace(/^_|_$/g, ""))}.png`;
      await page.screenshot({ path: file, fullPage: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      console.log(name, p, "horizontal overflow:", overflow);
    }
    console.log(name, "problems:", problems.length ? problems.join(" | ") : "none");
    await ctx.close();
  }
  await browser.close();
})();
