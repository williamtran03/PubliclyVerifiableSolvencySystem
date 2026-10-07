import { test, expect } from "@playwright/test";

test("the production build loads and navigates under the GitHub Pages project path", async ({ page }) => {
  const errors: string[] = [];
  const demoRequests: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => {
    if (new URL(request.url()).pathname.endsWith("/demo-config.json")) demoRequests.push(request.url());
  });
  await page.goto("./");
  await expect(page.getByRole("heading", { name: "Check a solvency snapshot" })).toBeVisible();
  await expect(page.locator("#demo")).toBeHidden();
  await expect(page.locator(".solution")).toHaveCount(3);
  await page.locator('[data-id="snarkless"]').click();
  await expect(page.locator("#disclosure")).toContainText("eight account slots");
  await page.locator(".wordmark").click();
  await expect(page).toHaveURL(/\/PubliclyVerifiableSolvencySystem\/$/);
  await expect(page.locator("#customerTab")).toBeVisible();
  expect(errors).toEqual([]);
  expect(demoRequests).toEqual([]);
});

test("help works under the Pages path and only loads video on demand", async ({ page }) => {
  const videoRequests: string[] = [];
  page.on("request", request => {
    if (request.url().endsWith(".mp4")) videoRequests.push(request.url());
  });
  await page.goto("./");
  await page.getByRole("link", { name: "Help", exact: true }).click();
  await expect(page).toHaveURL(/\/PubliclyVerifiableSolvencySystem\/help\.html$/);
  await expect(page.getByRole("heading", { name: "Verify your balances" })).toBeVisible();
  expect(videoRequests).toEqual([]);
  const video = page.locator("video");
  await video.evaluate((element: HTMLVideoElement) => element.load());
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThan(0);
  expect(await video.evaluate((element: HTMLVideoElement) => element.duration)).toBeCloseTo(358.93, 0);
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Help", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Back to application" }).click();
  await expect(page.getByRole("heading", { name: "Check a solvency snapshot" })).toBeVisible();
});
