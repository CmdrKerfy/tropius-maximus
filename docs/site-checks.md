# Site checks — local scripts and when to use them

Use this doc as the **standard entry point** for “did we break the site?” before a release or after risky changes (Explore performance, Supabase adapter, auth, batch, migrations).

## Dev server port (5173) vs Playwright (5174)

- **`npm run dev`** → Vite’s default **`http://localhost:5173`** — use this for everyday manual testing.
- **Playwright** (`playwright.config.mjs`) starts **`vite preview` on `127.0.0.1:5174`** so it does not collide with a dev server on 5173. You do not need to open 5174 unless you are debugging the E2E preview server.

## Node version (important for Playwright stability)

- Use **Node 24** locally (repo now includes **`.nvmrc`** with `24`).
- If you use `nvm`, run:

```bash
nvm use
```

- Running newer unsupported Node versions can cause flaky or hanging Playwright behavior.

## npm scripts

| Script | What it runs | Typical use |
|--------|----------------|-------------|
| **`npm run check:quick`** | Production **`vite build`** + **`npm test`** (Node unit tests in `src/lib/*.test.mjs`) | Fast gate on every PR / before push; no browser. |
| **`npm run check`** | **`check:quick`** then **`npm run test:e2e`** (Playwright) | Fuller local pass when you have a few minutes. |
| **`npm run test:e2e`** only | Playwright smoke (`tests/e2e/`) | Re-run browser tests without rebuilding (if `dist/` is already fresh). |

**Install browsers once** (if Playwright complains):

```bash
npm run test:e2e:install
```

## What Playwright covers (and what it does not)

- **Config:** `playwright.config.mjs` — starts **`vite preview`** on **127.0.0.1:5174** with **`VITE_USE_SUPABASE=false`** and **`VITE_REQUIRE_EMAIL_AUTH=false`** (DuckDB / GitHub Pages–style path, no live Supabase).
- **Tests:** `tests/e2e/smoke.spec.js` — minimal smoke (Explore heading, Batch page notice).
- **Not covered:** Signed-in Supabase flows, RLS, RPC migrations, Vercel env. For that, use **`docs/plans/e2e-vercel-smoke-checklist.md`** after deploy.

## Why `npm run test:e2e` can look “stuck”

After the `playwright test` line, Playwright may print **nothing for a long time**. That is often normal: `playwright.config.mjs` starts a **webServer** that first runs **`npm run build`**, then **`vite preview`** on **127.0.0.1:5174**. The build alone is often **tens of seconds to a couple of minutes** on a laptop, with no Playwright progress lines until the preview URL responds.

- **See what it is doing:** `DEBUG=pw:webserver npm run test:e2e`
- **Already built?** A warm `dist/` still triggers `npm run build` in the webServer command unless you change the config.

## If `npm run check` hangs or stalls

1. **Wait** at least as long as a fresh **`npm run build`** plus ~30s for preview + Chromium (or use **`DEBUG=pw:webserver`** above).
2. **Stop other Vite / Playwright** processes using **port 5174** (`lsof -i :5174` on macOS).
3. Confirm you are on **Node 24** (`node -v`, `nvm use`).
4. Confirm **`npm run build`** succeeds alone; the E2E webServer runs build again before preview.
5. If it sits past **~7 minutes**, check `playwright.config.mjs` webServer timeout (**420s**) and run with debug logs:

```bash
DEBUG=pw:webserver npm run test:e2e
```

## GitHub Actions

- **Workflow:** `.github/workflows/site-checks.yml` — runs **`npm run check:quick`** on every **push** and **pull_request** (Ubuntu, Node 24, `npm ci`). Same gate you can run locally before pushing.
- **Playwright in CI:** Not included yet (slower, needs browser install + cache tuning). Run **`npm run check`** locally or add a separate workflow job later if you want E2E on every PR.

## Alternatives (when a single `check` script is not enough)

- **Split jobs:** Keep **`check:quick`** in CI; add a second workflow (or job) for **`test:e2e`** with `playwright install --with-deps` and path filters so failures are obvious per stage.

## Related docs

- **Manual Vercel + Supabase smoke:** `docs/plans/e2e-vercel-smoke-checklist.md`
- **Infra before merge:** `docs/plans/p1-cutover-and-operations.md`
- **Explore performance / RPC rollback notes:** `docs/plans/explore-supabase-performance.md`
