# P1 — Cutover & operations (runbook)

**Use when:** v2 meets your test criteria and you are ready to treat it as production, or when you want a shared checklist for Vercel / Pages / monitoring without merging yet.

**Blocked until you decide:** merging `v2/supabase-migration` → `main` — **only with your explicit instruction** (documented in `CLAUDE.md` + `.cursor/rules/merge-main-owner-only.mdc`). QA and Vercel branch changes do **not** require merging.

**Current stance (owner):** **Pages (v1) and Vercel (v2) stay separate** until a later cutover. **V1 is frozen for user submissions** (no new custom cards / no relying on v1 as an editing surface); send everyone to the **Vercel** app for work. Document how you enforce that (URL policy, static replacement page on Pages, or a minimal `main` deploy that blocks writes + shows a banner).

---

## 1. Vercel (no merge required — can do anytime)

| Task                  | Where                                                   | Notes                                                                                                                                            |
| --------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Production branch** | Vercel → Project → Settings → Git → _Production Branch_ | Point at `v2/supabase-migration` for prod traffic while `main` stays Pages-only, **or** keep prod on `main` after merge.                         |
| **Env parity**        | Settings → Environment Variables                        | Production vs Preview must match intent (see checklist below). **Redeploy** after any variable change.                                         |
| **Preview behavior**  | Same                                                    | Confirm preview URLs are in Supabase Auth redirect allowlist if you test auth on previews.                                                       |

**Vercel env checklist (Preview + Production):** mirror **`.env.example`** — at minimum `VITE_USE_SUPABASE=true`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Also set as needed: `VITE_REQUIRE_EMAIL_AUTH`, `VITE_EXPERIMENTAL_NAV`, `VITE_USE_FILTER_OPTIONS_RPC`, `VITE_SUPABASE_AUTO_ANON_AUTH`, `VITE_BASE`. Optional feature flags should match what you tested locally.

Repo `vercel.json` already defines SPA rewrites; **branch choice is dashboard-only**.

### Pre-merge: Supabase migrations + production policy

Do **before** the final manual smoke in **`docs/plans/e2e-vercel-smoke-checklist.md`** (and before merging, if you merge).

1. **Supabase — migration parity (each project: preview DB, prod DB, etc.):** Apply SQL under `supabase/migrations/` **in order** through the latest file on the branch you ship. For current Batch/History features, **`024_batch_selections.sql`** and **`025_batch_runs_edit_history.sql`** must be applied on every environment that runs this app. Older or long-lived projects may still need **`013`**–**023** and RPC migrations per **`CLAUDE.md`** (schema / migration list).
2. **Production hardening (when you aim for “real” production):** Follow **`docs/plans/production-hardening-anon-auth.md`** — e.g. migration **`019`**, Anonymous provider off in Supabase, `VITE_SUPABASE_AUTO_ANON_AUTH` / `VITE_REQUIRE_EMAIL_AUTH` aligned with policy. This is separate from preview testing but required before a public cutover.

---

## 2. GitHub Pages vs Vercel-only (decision record)

When you cut over:

- **Vercel-only:** Keep `main` for ingest + optional v1 archive; turn off or stop caring about **deploy-pages** for user traffic (may still run on `main` pushes per `CLAUDE.md` — adjust workflow or accept extra deploys).
- **Dual for a while:** Pages = old v1 URL for stragglers; Vercel = canonical v2 — document both URLs for collaborators.

Write the chosen URL(s) in this file or team notes when decided.

---

## 3. Post-deploy monitoring (lightweight)

| Cadence                                | What                                                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **After each prod deploy**             | Vercel → Deployments → open latest → build/runtime errors.                                                    |
| **Weekly**                             | GitHub Actions → _Ingest and push to Supabase_ (scheduled on **default branch**, usually `main`) — green run. |
| **When users report auth/data issues** | Supabase → Logs / Auth / Database; check RLS-related errors.                                                  |

---

## 4. Rollback (no merge scenario)

If **only Vercel** is wrong after a deploy:

1. Vercel → Production deployment → **Promote** a previous known-good deployment, **or**
2. **Redeploy** a prior Git commit from the Deployments UI.

If **env** broke production:

1. Revert the bad variable in Vercel → **Redeploy**.

If **`main` was merged** and something is catastrophic:

1. Revert the merge commit on `main` (new PR), **or**
2. Reset `main` only if team policy allows force-push (usually avoid on shared repos).

Git tag **`pre-supabase-migration`** remains a historical snapshot per `CLAUDE.md`; it is not a live rollback target unless you explicitly redeploy from that ref.

---

## 5. SMTP (Supabase dashboard — optional)

If magic-link / password-reset email hits rate limits or spam folders:

1. Supabase → **Project Settings** → **Auth** → **SMTP** (or Custom SMTP in docs).
2. Configure provider credentials; keep secrets out of git.

Official guide: [Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

---

## 6. When you _are_ ready to merge (your gate — owner-initiated only)

**Merges into `main` are done only when you explicitly choose to** (not by automation or agent default).

1. **Infra:** Complete **§1** (Vercel env) and **Pre-merge: Supabase migrations + production policy** under **§1** (migration parity + hardening plan as appropriate).
2. **Final QA:** Run **`docs/plans/e2e-vercel-smoke-checklist.md`** on the deploy + Supabase pair you will ship (last check before merge).
3. Merge `v2/supabase-migration` → `main` **or** keep branch split and only move Vercel prod branch — align with **§2** above.
4. Run **Ingest and push to Supabase** once if `push_duckdb_to_supabase.py` / migrations changed on `main`.
5. Re-read **Production checklist** in **`CLAUDE.md`** (RLS, anon auth, env flags).
6. **Postgres + Storage (legacy projects):** If the target Supabase project predates older v2 work, confirm applied: **`013_profiles.sql`**, **`014_storage_avatars.sql`**, and any migrations listed in **`CLAUDE.md`** you have not yet applied. Re-run ingest push only if `push_duckdb_to_supabase.py` / card schema changed (step 4 above).

---

_Added for P1 tracking — merge timing is owner-controlled. Last ops note sync: 2026-04-19._
