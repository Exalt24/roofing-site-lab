// Tell Bing (and every IndexNow search engine) which URLs changed, from the live sitemap. Needs the key file the site serves at /<key>.txt.
//   node tools/indexnow.mjs https://seabreeze-roofing-lab.pages.dev <key>
// IndexNow answers 200 or 202 when it accepts the list; 403 means the key file was not found at the address it checks.
const [site, key] = process.argv.slice(2);
if (!site || !key) { console.error("usage: node tools/indexnow.mjs <site url> <key>"); process.exit(1); }
const xml = await (await fetch(new URL("/sitemap.xml", site))).text();
const urlList = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const host = new URL(site).host;
const res = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host, key, keyLocation: `${new URL(site).origin}/${key}.txt`, urlList }),
});
console.log(`submitted ${urlList.length} urls, IndexNow answered ${res.status} ${await res.text()}`);
