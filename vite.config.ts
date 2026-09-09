import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: "frontend",
  resolve: {
    alias: {
      "@prover": resolve(import.meta.dirname, "prover"),
    },
  },
  server: {
    fs: { allow: [".."] },
  },
});
