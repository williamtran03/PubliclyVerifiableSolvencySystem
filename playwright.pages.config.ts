import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./open-solvency/pages-test",
  use: { baseURL: "http://127.0.0.1:5177/PubliclyVerifiableSolvencySystem/", browserName: "chromium" },
  webServer: {
    command: "npm exec vite -- preview --config vite.opensolvency.config.ts --base /PubliclyVerifiableSolvencySystem/ --host 127.0.0.1 --port 5177 --strictPort",
    url: "http://127.0.0.1:5177/PubliclyVerifiableSolvencySystem/",
    reuseExistingServer: false,
  },
});
