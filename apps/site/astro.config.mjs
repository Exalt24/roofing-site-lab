// @ts-check
import { defineConfig } from "astro/config";

export default defineConfig({
  site: process.env.SITE_URL || "https://seabreeze-roofing.example",
  trailingSlash: "always",
  compressHTML: true,
  build: { inlineStylesheets: "always", format: "directory" },
});
