import { test, expect } from "@playwright/test";

test.describe("Smoke (local DuckDB, no Supabase)", () => {
  test("Explore loads and shows the app title", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Tropius Maximus Pokemon Tracker/i })).toBeVisible();
  });

  test("Batch page shows Supabase-only notice when not configured", async ({ page }) => {
    await page.goto("/batch");
    await expect(page.getByRole("heading", { name: /Batch edit/i })).toBeVisible();
    await expect(page.getByText(/Batch edit uses Supabase/i)).toBeVisible();
  });
});
