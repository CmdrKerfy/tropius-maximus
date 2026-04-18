# Plan: User dashboards + email/password auth (v2)

**Status:** Approved direction — implement on **`v2/supabase-migration`**.  
**Supersedes for auth UX:** `docs/plans/user-profiles-and-activity.md` still applies for **`profiles`**, **`edit_history` names**, and **`created_by`**, but **primary sign-in becomes email + password** instead of magic link.

**Audience:** Owner + implementers.

---

## Goals

1. **Familiar login:** Email + password (users already understand “account” flows); optional **Forgot password** / reset email.
2. **Invite-only:** No public self-registration; only allowlisted emails (reuse **`signup_allowlist`**) can complete first-time signup or sign in.
3. **User dashboard:** A dedicated **personal home** after login (e.g. **`/dashboard`** or **`/me`**) with:
   - Short welcome + **display name** (from **`profiles`**).
   - **Recent activity** — own rows from **`edit_history`** (Workbench/Batch edits), with links into card/detail or history filtered view.
   - **My submitted cards** — **`cards`** where **`created_by = auth.uid()`** and relevant `origin` (e.g. manual), newest first.
   - **Quick links** — Explore, Workbench, Edit history (“my edits”), optional **Profile** (`/profile`) for editing display name / future avatar.
4. **Attribution unchanged:** Keep populating **`edit_history.edited_by`** and **`cards.created_by`** from session (already in **`appAdapter.js`**); dashboard is read-mostly on those columns.

## Terminology

- **“Username” in product copy** can mean **email address** (Supabase default identifier). Avoid requiring a separate login handle unless you add a column and uniqueness rules later.
- **`profiles.display_name`** — human-readable name on dashboard and edit history (not used for authentication).

## Non-goals (initial delivery)

- Social OAuth (Google, etc.) — optional later.
- **Magic link as primary** — demoted to optional “email me a login link” recovery only, or removed if password reset is enough.
- Public sign-up — stays closed; **allowlist + invite secret** remain.

---

## Current state (baseline)

| Piece | Location |
|--------|-----------|
| Login UI | `src/pages/LoginPage.jsx` — email + team code → Edge Function **`request-magic-link`** |
| Edge Function | `supabase/functions/request-magic-link/index.ts` — validates **`INVITE_SECRET`** + **`signup_allowlist`**, then **`admin.auth.signInWithOtp`** |
| Callback | `src/pages/AuthCallbackPage.jsx` — implicit flow for magic-link tokens in URL |
| Client | `src/lib/supabaseClient.js` — `flowType: "implicit"` (needed when magic link opened on another device) |
| Routes / guard | `src/App.jsx`, `src/components/RequireAuth.jsx`, `src/lib/authInvite.js` |

---

## Supabase project configuration (manual / Dashboard)

Do **before** or in parallel with first migration:

1. **Authentication → Providers → Email** — enable **Email** provider; enable **“Confirm email”** only if you want verification emails on signup (small team may turn off for simplicity; document choice).
2. **Password policy** — set minimum length and complexity in Dashboard to match product expectations.
3. **Site URL / Redirect URLs** — include Vercel production + preview origins and local dev; paths used for **password reset** redirects (e.g. `/auth/reset` or `/login?reset=1`).
4. **Email templates** — customize “Reset password” and optionally “Confirm signup” copy to match Tropius branding.
5. **Rate limiting** — rely on Supabase defaults initially; tighten if abused.

---

## Architecture decisions

### A. First-time account (allowlisted user, no password yet)

**Option A1 (recommended):** New Edge Function **`invite-set-password`** (or extend existing with a `mode` flag):

- POST: `{ email, inviteCode, password }` (password meets policy client-side + server re-check length).
- Validates **`inviteCode === INVITE_SECRET`** and email in **`signup_allowlist`**.
- Service role: **`auth.admin.createUser({ email, password, email_confirm: true })`** if user does not exist, **or** **`auth.admin.updateUserById`** to set password if user exists but has never set one (rare).
- Returns success; client then **`signInWithPassword({ email, password })`** and redirects to **`/dashboard`**.

**Option A2:** Admin creates users in Dashboard only; first login is “forgot password” — heavier ops burden, skip for small team unless preferred.

### B. Returning user

- **`signInWithPassword`** on **`LoginPage`** (or dedicated **`/login`** tab).
- No magic link required for happy path.

### C. Forgot password

- **`resetPasswordForEmail`** with **`redirectTo`** pointing to a route that reads hash tokens and calls **`updateUser`** / session recovery per Supabase docs (typically **`/auth/callback`** or a thin **`PasswordResetPage`** using `detectSessionInUrl`).

### D. Session / client config

- Evaluate **`flowType: "pkce"`** for password-only flows (better for SPAs when no cross-device magic link). **Test** magic-link removal: if any recovery still uses OTP in email, keep **`implicit`** for that path only or use PKCE + same-device only for recovery.
- Document final choice in this file when implemented.

### E. Deprecating `request-magic-link`

- Stop calling it from **`LoginPage`** for primary UX.
- Keep function deployed until all users migrated, then remove or repurpose (e.g. internal admin only).

---

## Schema & RLS (align with profiles plan)

1. **`profiles`** table — same as **`user-profiles-and-activity.md`**: `id uuid PK references auth.users`, `display_name`, optional `avatar_url`, timestamps.
2. **Trigger** on **`auth.users` AFTER INSERT** → insert **`profiles`** row with default **`display_name`** (e.g. email local-part) or leave null until first dashboard visit.
3. **RLS** — authenticated read all **`profiles`** (small team); update only own row.
4. **`edit_history` / `cards`** — ensure policies allow:
   - authenticated **SELECT** for dashboard aggregations (own rows at minimum; team-wide read optional for “recent team activity” widget — default to **own only** for v1 dashboard).
5. **Migration file:** e.g. **`013_profiles.sql`** (or next free number after repo tip).

---

## Dashboard UX (routes)

| Route | Purpose |
|--------|---------|
| **`/dashboard`** | Default post-login landing; sections below. |
| **`/profile`** | Edit **`display_name`** (and future avatar); show read-only email. |
| **`/history`** | Existing page; add **“Only my edits”** default-on or toggle when coming from dashboard link. |

**Dashboard sections (single scroll or tabs):**

1. **Header** — “Hi, {display_name}” + Sign out (reuse **`AuthUserMenu`** patterns).
2. **Stats row (optional v2)** — count of my edits last 7 days, my manual cards — simple SQL or RPC.
3. **Recent edits** — last N from **`edit_history`** where **`edited_by = auth.uid()`**, columns: time, card id, summary; link to Workbench/Explore if feasible.
4. **My cards** — table/list from **`cards`** where **`created_by = auth.uid()`** ORDER BY **`created_at`** DESC.
5. **Footer links** — Explore, Workbench, Batch, Fields, Health as today.

**Nav:** Add **“Dashboard”** (or “Home”) to shell nav; after **`signInWithPassword`**, **`navigate('/dashboard')`** instead of only `from` state.

---

## Implementation phases (suggested order)

| Phase | Scope | Notes |
|-------|--------|--------|
| **1** | **`013_profiles.sql`** + RLS + trigger + backfill existing **`auth.users`** | Unblocks display names everywhere. |
| **2** | **Supabase Dashboard** email provider + redirect URLs + templates | Coordinate with deploy envs. |
| **3** | **Edge Function** `invite-set-password` (or equivalent) + wire **`LoginPage`** | First-time: email + invite code + password → create/update user → client password sign-in. |
| **4** | **`LoginPage`** — returning user: email + password; **Forgot password** link | Remove primary magic-link copy. |
| **5** | **`PasswordResetPage`** / callback handling for recovery | Hash in URL handling per Supabase v2 JS docs. |
| **6** | **`/dashboard`** page + TanStack Query + **`App.jsx`** route + nav | Uses **`fetchProfile`**, **`fetchMyEditHistory`**, **`fetchMyCards`** in **`appAdapter.js`**. |
| **7** | **`/profile`** page + **`AuthUserMenu`** link | Mutation for **`display_name`**. |
| **8** | **`EditHistoryPage`** — join **`profiles`**, **“Only my edits”** filter | Completes cross-app visibility. |
| **9** | **Audit `cards.created_by`** on all insert paths | Required for honest “My cards”. |
| **10** | **`RequireAuth`** / **`authInvite.js`** — post-login redirect to **`/dashboard`** | Optional env **`VITE_POST_LOGIN_PATH`**. |
| **11** | **Cleanup** — remove or archive **`request-magic-link`** primary path; **`supabaseClient`** flowType decision | Docs + **`CLAUDE.md`** update. |

**Rough effort:** ~3–6 engineering days depending on Edge Function + reset-flow polish and existing **`appAdapter`** surface.

---

## Key files to touch

- `supabase/migrations/013_profiles.sql` (number may bump)
- `supabase/functions/invite-set-password/` (+ `config.toml` JWT rules)
- `src/pages/LoginPage.jsx`
- `src/pages/DashboardPage.jsx` (**new**)
- `src/pages/ProfilePage.jsx` (**new**) or extend existing shell
- `src/pages/AuthCallbackPage.jsx` / **`PasswordResetPage.jsx`** (**new**)
- `src/App.jsx` — routes **`/dashboard`**, **`/profile`**
- `src/components/AuthUserMenu.jsx` — Dashboard + Profile links
- `src/data/supabase/appAdapter.js` — profile CRUD, my edits, my cards queries
- `src/pages/EditHistoryPage.jsx` — profile join + filter
- `src/lib/supabaseClient.js` — auth options after PKCE/implicit decision
- `docs/plans/user-profiles-and-activity.md` — add banner: **“Auth: see user-dashboards-and-password-auth.md”**
- Root **`CLAUDE.md`** — paused backlog pointer when work starts

---

## Verification checklist

- [ ] Allowlisted new user: can set password with invite code, lands on **`/dashboard`**.
- [ ] Returning user: email + password only; session persists refresh.
- [ ] Forgot password: email arrives, link completes, new password works.
- [ ] Non-allowlisted email: cannot create user or sign in (clear error).
- [ ] Dashboard: recent edits and my cards match DB for **`auth.uid()`**.
- [ ] Edit history shows **display names**; “only my edits” correct.
- [ ] Workbench save still writes **`edit_history.edited_by`**.

---

## Risks / mitigations

| Risk | Mitigation |
|------|------------|
| Service-role Edge Function abuse | Keep **`INVITE_SECRET`** strong; rate-limit function; optional CAPTCHA later. |
| Password reuse / weak passwords | Enforce Supabase policy + client hints. |
| Existing magic-link-only users | One-time “set your password” email from admin **or** runbook: use forgot-password after user row exists. |
| PKCE vs implicit regression | Test full matrix (login, reset, deep links) on Vercel preview. |

---

## Implementation log (repo)

| Date | Done |
|------|------|
| 2026-04-18 | **`013_profiles.sql`**: `profiles` table, `auth.users` trigger, RLS, indexes on `edit_history(edited_by)` and `cards(created_by)`, backfill. |
| 2026-04-18 | **Edge Function** `invite-set-password` + **`config.toml`** entry. |
| 2026-04-18 | **`LoginPage`**: sign-in, create account (POST function), forgot password → **`/auth/reset-password`**. |
| 2026-04-18 | **`AuthResetPasswordPage`**, **`AuthCallbackPage`** → post-login **`/dashboard`**. |
| 2026-04-18 | **`DashboardPage`**, **`ProfilePage`**, **`App.jsx`** routes; **`appAdapter`** `fetchProfile` / `upsertProfile` / `fetchMyEditHistory` / `fetchMyCards`; **`db.js`** exports; **`AuthUserMenu`** links. |

**Still manual / follow-up:** Run migration and deploy Edge Function in Supabase; enable **Email** provider + redirect URLs; **`EditHistoryPage`** profile join + “only my edits” filter (plan phase 8); audit **`cards.created_by`** on inserts when custom-card Supabase path ships.

---

*Created: 2026-04-18 — complements `user-profiles-and-activity.md` for dashboard + password-primary auth.*
