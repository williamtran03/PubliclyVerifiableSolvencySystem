import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: "demo-site",
  resolve: {
    alias: {
      "@prover": resolve(import.meta.dirname, "prover"),
    },
  },
  build: {
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, "demo-site/index.html"),
        account: resolve(import.meta.dirname, "demo-site/account.html"),
        operator: resolve(import.meta.dirname, "demo-site/operator.html"),
      },
    },
  },
  server: {
    port: 5174,
    fs: { allow: [".."] },
  },
});
