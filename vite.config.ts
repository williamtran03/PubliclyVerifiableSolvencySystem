import { defineConfig } from "vite";
import { resolve } from "node:path";

// The superseded single-asset arm's inclusion-proof page.
export default defineConfig({
  root: "arms/single-asset/site",
  resolve: {
    alias: {
      "@shared": resolve(import.meta.dirname, "shared"),
      "@arms": resolve(import.meta.dirname, "arms"),
    },
  },
  server: {
    fs: { allow: ["../../.."] },
  },
});
