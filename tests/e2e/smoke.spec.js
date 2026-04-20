import { test, expect } from "@playwright/test";

async function waitForAppReady(page) {
  await expect
    .poll(
      async () => {
        const body = (await page.textContent("body")) || "";
        return body.replace(/\s+/g, " ").trim();
      },
      { timeout: 120_000, intervals: [500, 1000, 1500] }
    )
    .not.toContain("Loading Tropius Maximus");
}

test.describe("Smoke (local DuckDB, no Supabase)", () => {
  test("Explore loads and shows core shell", async ({ page }) => {
    await page.goto("/");
    await waitForAppReady(page);
    await expect(page.getByText(/Tropius Maximus/i)).toBeVisible();
    await expect(page.getByPlaceholder(/Search cards/i)).toBeVisible();
  });

  test("Batch page shows Supabase-only notice when not configured", async ({ page }) => {
    await page.goto("/batch");
    await waitForAppReady(page);
    await expect(page.getByText(/Batch edit/i)).toBeVisible();
    await expect(page.getByText(/Batch edit uses Supabase/i)).toBeVisible();
  });
});
