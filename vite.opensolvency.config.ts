import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: "open-solvency",
  resolve: { alias: { "@shared": resolve(import.meta.dirname, "shared"), "@arms": resolve(import.meta.dirname, "arms") } },
  server: { port: 5175, fs: { allow: [".."] } },
});
