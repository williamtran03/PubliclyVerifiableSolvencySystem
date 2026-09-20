import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./open-solvency/test",
  fullyParallel: true,
  use: { baseURL: "http://127.0.0.1:5176", browserName: "chromium", trace: "retain-on-failure" },
  webServer: {
    command: "npm run web -- --host 127.0.0.1 --port 5176 --strictPort",
    url: "http://127.0.0.1:5176",
    reuseExistingServer: false,
  },
});
