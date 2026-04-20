import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke E2E: starts Vite with DuckDB mode + no email gate so protected routes load without Supabase.
 * For full Supabase flows, run against a preview URL with env (see docs/plans/batch-future-enhancements.md).
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  globalTimeout: 600_000,
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
    // Always boot a fresh preview for deterministic env/mode and fewer stale-process hangs.
    reuseExistingServer: false,
    timeout: 420_000,
  },
});
