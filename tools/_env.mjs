// Settings for the tools that talk to Sanity and Cloudflare. They come from environment variables.
// To keep them in a file instead, put KEY=VALUE lines in it and point SECRETS_FILE at it; nothing is read from any other place and nothing is printed.
import fs from "node:fs";

function fileValues() {
  const p = process.env.SECRETS_FILE;
  if (!p) return {};
  const out = {};
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0 && !line.trim().startsWith("#")) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

/** Returns the named settings, each from the environment first and then from SECRETS_FILE. Throws once, naming every missing one. */
export function settings(...names) {
  const file = fileValues();
  const out = {};
  const missing = [];
  for (const n of names) {
    const v = process.env[n] || file[n];
    if (!v) missing.push(n); else out[n] = v;
  }
  if (missing.length) throw new Error(`Missing ${missing.join(", ")}. Set them in the environment, or in a KEY=VALUE file named by SECRETS_FILE. See README, "Run it against your own accounts".`);
  return out;
}

export const sanitySettings = () => {
  const s = settings("SANITY_PROJECT_ID", "SANITY_TOKEN");
  return { projectId: s.SANITY_PROJECT_ID, token: s.SANITY_TOKEN, dataset: process.env.SANITY_DATASET || fileValues().SANITY_DATASET || "production" };
};

export const cloudflareSettings = () => settings("CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID");
