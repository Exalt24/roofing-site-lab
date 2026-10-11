// Build the site from Sanity and deploy it to Cloudflare Pages in your own Cloudflare account. Needs SANITY_PROJECT_ID, SANITY_TOKEN, CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID (environment or SECRETS_FILE, see tools/_env.mjs); tokens are never printed. Set PAGES_PROJECT to your own Pages project name (one project per brand).
//   node tools/deploy_pages.mjs [--env KEY=VALUE ...]   (PUBLIC_GTM_ID, PUBLIC_GSC_TOKEN, PUBLIC_BING_TOKEN, PUBLIC_LEAD_ENDPOINT ...)
// wrangler runs from a neutral folder: inside the project it "auto-configures" the repo (adds an SSR adapter), which a static site does not want.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { cloudflareSettings, sanitySettings } from "./_env.mjs";

const root = path.resolve(import.meta.dirname, "..");
const site = path.join(root, "apps", "site");
const PROJECT = process.env.PAGES_PROJECT ?? "seabreeze-roofing-lab"; // one Pages project per brand
const URL_ = `https://${PROJECT}.pages.dev`;
const cf = cloudflareSettings();
const sn = sanitySettings();
const extra = {};
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) if (args[i] === "--env") { const [k, ...v] = args[++i].split("="); extra[k] = v.join("="); }
const env = { ...process.env, ...extra, SANITY_PROJECT_ID: sn.projectId, SANITY_DATASET: sn.dataset, SITE_URL: URL_, CLOUDFLARE_API_TOKEN: cf.CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID: cf.CLOUDFLARE_ACCOUNT_ID };
const astro = path.join(root, "node_modules", "astro", "bin", "astro.mjs");
execFileSync(process.execPath, [astro, "build"], { cwd: site, stdio: "inherit", env });

// production images and video come from Sanity; the local fixture copies are not shipped
for (const d of ["photos", "videos", "callrail-sim.js"]) fs.rmSync(path.join(site, "dist", d), { recursive: true, force: true }); // the swap simulator is a test fixture, never shipped

const api = async (method, p, body) => {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${cf.CLOUDFLARE_ACCOUNT_ID}${p}`, { method, headers: { Authorization: `Bearer ${cf.CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
const existing = await api("GET", `/pages/projects/${PROJECT}`);
if (existing.status === 404) {
  const made = await api("POST", "/pages/projects", { name: PROJECT, production_branch: "main" });
  console.log("project create:", made.status, made.json.success);
  if (!made.json.success) { console.error(JSON.stringify(made.json.errors)); process.exit(1); }
}
const neutral = fs.mkdtempSync(path.join(os.tmpdir(), "pages-deploy-"));
execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["-y", "wrangler", "pages", "deploy", path.join(site, "dist"), "--project-name", PROJECT, "--branch", "main", "--commit-dirty=true"], { cwd: neutral, stdio: "inherit", env, shell: process.platform === "win32" });
console.log("deployed", URL_);
