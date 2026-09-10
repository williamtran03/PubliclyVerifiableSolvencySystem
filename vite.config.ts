import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: "frontend",
  server: {
    host: "127.0.0.1",
    proxy: { "/api": "http://127.0.0.1:8787" },
    fs: {
      allow: [resolve(import.meta.dirname, "frontend"), resolve(import.meta.dirname, "prover"), resolve(import.meta.dirname, "node_modules")],
      deny: ["**/*.private.json", "**/private/**", "**/.env*", "**/backend/**"],
    },
  },
});
