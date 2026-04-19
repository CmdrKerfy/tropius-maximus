# P1 — Cutover & operations (runbook)

**Use when:** v2 meets your test criteria and you are ready to treat it as production, or when you want a shared checklist for Vercel / Pages / monitoring without merging yet.

**Blocked until you decide:** merging `v2/supabase-migration` → `main` — **only with your explicit instruction** (documented in `CLAUDE.md` + `.cursor/rules/merge-main-owner-only.mdc`). QA and Vercel branch changes do **not** require merging.

---

## 1. Vercel (no merge required — can do anytime)

| Task                  | Where                                                   | Notes                                                                                                                                            |
| --------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Production branch** | Vercel → Project → Settings → Git → _Production Branch_ | Point at `v2/supabase-migration` for prod traffic while `main` stays Pages-only, **or** keep prod on `main` after merge.                         |
| **Env parity**        | Settings → Environment Variables                        | Production vs Preview: `VITE_USE_SUPABASE`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_REQUIRE_EMAIL_AUTH`, etc. Redeploy after edits. |
| **Preview behavior**  | Same                                                    | Confirm preview URLs are in Supabase Auth redirect allowlist if you test auth on previews.                                                       |

Repo `vercel.json` already defines SPA rewrites; **branch choice is dashboard-only**.

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

Kerfy → **Owner:**

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

1. Final QA on Vercel production (or prod branch) against Supabase (see **`docs/plans/e2e-vercel-smoke-checklist.md`**).
2. Merge `v2/supabase-migration` → `main` **or** keep branch split and only move Vercel prod branch — align with **§2** above.
3. Run **Ingest and push to Supabase** once if `push_duckdb_to_supabase.py` / migrations changed on `main`.
4. Re-read **Production checklist** in `CLAUDE.md` (RLS, anon auth, env flags).
5. **Postgres + Storage migrations:** If the target Supabase project predates recent v2 work, confirm applied: **`013_profiles.sql`** (profiles + triggers + RLS) and **`014_storage_avatars.sql`** (avatar bucket + Storage policies). Re-run ingest push only if `push_duckdb_to_supabase.py` / card schema changed (step 3 above).

---

_Added for P1 tracking — merge timing is owner-controlled. Last ops note sync: 2026-04-17._
