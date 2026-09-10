import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: "demo-site",
  resolve: {
    alias: {
      "@prover": resolve(import.meta.dirname, "prover"),
    },
  },
  server: {
    port: 5174,
    fs: { allow: [".."] },
  },
});
