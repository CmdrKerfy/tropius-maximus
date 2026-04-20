import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke E2E: starts Vite with DuckDB mode + no email gate so protected routes load without Supabase.
 * For full Supabase flows, run against a preview URL with env (see docs/plans/batch-future-enhancements.md).
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5174",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Preview after build starts faster than `vite dev` (DuckDB WASM dev compile can exceed default timeouts).
    command:
      "VITE_REQUIRE_EMAIL_AUTH=false VITE_USE_SUPABASE=false npm run build && VITE_REQUIRE_EMAIL_AUTH=false VITE_USE_SUPABASE=false npx vite preview --host 127.0.0.1 --port 5174 --strictPort",
    url: "http://127.0.0.1:5174",
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
  },
});
