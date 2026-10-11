// One viewport screenshot (not full page) at a given scroll position, so fixed elements such as the sticky call bar appear where a person would see them.
//   node tools/viewport_shot.cjs <url> <out.png> [width] [height] [scrollY]
const { chromium } = require("playwright");
const [url, out, w = "390", h = "844", y = "0"] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch({ headless: true });
  const p = await (await b.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: 2 })).newPage();
  await p.goto(url, { waitUntil: "load" });
  await p.evaluate((n) => window.scrollTo(0, n), +y);
  await p.waitForTimeout(500);
  await p.screenshot({ path: out });
  const info = await p.evaluate(() => { const s = document.querySelector(".sticky-bar"); const r = s && s.getBoundingClientRect(); return { sticky: r ? { top: Math.round(r.top), h: Math.round(r.height), display: getComputedStyle(s).display } : null, bodyPad: getComputedStyle(document.body).paddingBottom }; });
  console.log(JSON.stringify(info));
  await b.close();
})();
