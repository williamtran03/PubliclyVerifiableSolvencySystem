import { test, expect } from "@playwright/test";

test("the production build loads and navigates under the GitHub Pages project path", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
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
});
