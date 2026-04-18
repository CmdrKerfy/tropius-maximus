# Plan: User dashboards + email/password auth (v2)

**Status (2026-04-17):** **Approved** — much of the **profiles / dashboard / history / teammate profile / avatars** surface is **already shipped** on **`v2/supabase-migration`** (see **`user-profiles-and-activity.md`** and migrations **`013`–`014`**). This document tracks **password-primary auth**, **Edge Function `invite-set-password`**, **reset password**, and **nav / post-login** polish still called out below.

**Cross-ref:** `docs/plans/user-profiles-and-activity.md` remains canonical for **`profiles`**, **`edit_history`** display names, **`created_by`**, **`/profile`**, **`/profile/:userId`**, and **Storage avatars**.

**Audience:** Owner + implementers.

---

## Goals

1. **Familiar login:** Email + password (users already understand “account” flows); optional **Forgot password** / reset email.
2. **Invite-only:** No public self-registration; only allowlisted emails (reuse **`signup_allowlist`**) can complete first-time signup or sign in.
3. **User dashboard:** A dedicated **personal home** after login (e.g. **`/dashboard`** or **`/me`**) with:
   - Short welcome + **display name** (from **`profiles`**).
   - **Recent activity** — own rows from **`edit_history`** (Workbench/Batch edits), with links into card/detail or history filtered view.
   - **My submitted cards** — **`cards`** where **`created_by = auth.uid()`** and relevant `origin` (e.g. manual), newest first.
   - **Quick links** — Explore, Workbench, Edit history (“my edits”), **Profile** (`/profile`) for display name + **avatar upload** (requires Storage migration **`014`** on that Supabase project).
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
| Login UI | `src/pages/LoginPage.jsx` — **email + password** sign-in, **Create account** (→ **`invite-set-password`**), forgot password; optional magic-link path per env |
| Edge Functions | **`invite-set-password`** (password / create user); **`request-magic-link`** (OTP) — both use **`INVITE_SECRET`** + **`signup_allowlist`** |
| Callback / reset | `src/pages/AuthCallbackPage.jsx`, **`AuthResetPasswordPage.jsx`** — session + recovery URLs |
| Client | `src/lib/supabaseClient.js` — `flowType: "implicit"` where cross-device magic link still matters |
| Routes / guard | `src/App.jsx`, **`RequireAuth.jsx`**, **`authInvite.js`** — includes **`/dashboard`**, **`/profile`**, **`/profile/:userId`** |
| Profiles + Storage | **`013_profiles.sql`**, **`014_storage_avatars.sql`**; **`ProfilePage`**, **`uploadProfileAvatar`** / **`removeProfileAvatar`** in **`appAdapter.js`** |
| Dashboard + history | **`DashboardPage.jsx`**; **`EditHistoryPage.jsx`** — editor display names, link to **`/profile/{edited_by}`**, “only my edits”; dashboard card links → **`/?card=…`** |

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
5. **Migrations in repo:** **`013_profiles.sql`**, **`014_storage_avatars.sql`** — apply both on each Supabase environment that should support profiles + avatars.

---

## Dashboard UX (routes)

| Route | Purpose |
|--------|---------|
| **`/dashboard`** | Personal home: recent edits, my submitted cards (shipped). |
| **`/profile`** | Edit own **`display_name`**, email read-only, **avatar** upload/remove (shipped). |
| **`/profile/:userId`** | Read-only teammate profile when UUID ≠ session user (shipped). |
| **`/history`** | Team history + **“Only my edits”**; editor column links to **`/profile/{edited_by}`** (shipped). |

**Dashboard sections (single scroll or tabs):**

1. **Header** — “Hi, {display_name}” + Sign out (reuse **`AuthUserMenu`** patterns).
2. **Stats row (optional v2)** — count of my edits last 7 days, my manual cards — simple SQL or RPC.
3. **Recent edits** — last N from **`edit_history`** where **`edited_by = auth.uid()`**, columns: time, card id, summary; link to Workbench/Explore if feasible.
4. **My cards** — table/list from **`cards`** where **`created_by = auth.uid()`** ORDER BY **`created_at`** DESC.
5. **Footer links** — Explore, Workbench, Batch, Fields, Health as today.

**Nav:** Add **“Dashboard”** (or “Home”) to shell nav; after **`signInWithPassword`**, **`navigate('/dashboard')`** instead of only `from` state.

---

## Implementation phases (suggested order)

| Phase | Scope | Status |
|-------|--------|--------|
| **1** | **`013_profiles.sql`** + RLS + trigger + backfill existing **`auth.users`** | **Done** (see profiles plan). |
| **1b** | **`014_storage_avatars.sql`** + profile avatar upload/remove UI | **Done** (apply SQL per Supabase project). |
| **2** | **Supabase Dashboard** email provider + redirect URLs + templates | **Ops** — verify each env. |
| **3** | **Edge Function** `invite-set-password` + wire **`LoginPage`** | **In repo** — deploy + secrets per env. |
| **4** | **`LoginPage`** — returning user: email + password; **Forgot password** | **In repo** — confirm copy/UX vs magic link. |
| **5** | **`AuthResetPasswordPage`** / callback handling for recovery | **In repo** — verify on Vercel previews. |
| **6** | **`/dashboard`** + **`App.jsx`** route + nav | **Done**. |
| **7** | **`/profile`** + **`AuthUserMenu`** link + **`display_name`** mutation | **Done** (+ avatars). |
| **7b** | **`/profile/:userId`** read-only teammate view + **`fetchProfileById`** | **Done**. |
| **8** | **`EditHistoryPage`** — join **`profiles`**, **“Only my edits”**, editor profile links | **Done**. |
| **9** | **`cards.created_by`** on manual insert paths | **Done** in **`appAdapter`** (keep auditing new paths). |
| **10** | **`RequireAuth`** / **`authInvite.js`** — post-login redirect to **`/dashboard`** | **Verify** desired default; optional **`VITE_POST_LOGIN_PATH`**. |
| **11** | **Cleanup** — demote/remove **`request-magic-link`** primary path if unused; **`supabaseClient`** flowType | **When product decides**; document in this file. |

**Rough effort:** ~3–6 engineering days depending on Edge Function + reset-flow polish and existing **`appAdapter`** surface.

---

## Key files (reference)

- `supabase/migrations/013_profiles.sql`, `014_storage_avatars.sql`
- `supabase/functions/invite-set-password/` (+ `config.toml` JWT rules)
- `src/pages/LoginPage.jsx`
- `src/pages/DashboardPage.jsx`
- `src/pages/ProfilePage.jsx`
- `src/pages/AuthCallbackPage.jsx`, `src/pages/AuthResetPasswordPage.jsx`
- `src/App.jsx` — routes **`/dashboard`**, **`/profile`**, **`/profile/:userId`**, auth routes
- `src/components/AuthUserMenu.jsx` — Dashboard + Profile links
- `src/data/supabase/appAdapter.js` — **`fetchProfile`**, **`fetchProfileById`**, **`upsertProfile`**, **`uploadProfileAvatar`**, **`removeProfileAvatar`**, my edits, my cards, **`created_by`** on inserts
- `src/pages/EditHistoryPage.jsx` — profile names + filter + editor links
- `src/lib/supabaseClient.js` — auth options after PKCE/implicit decision
- `docs/plans/user-profiles-and-activity.md` — profiles + avatars status
- Root **`CLAUDE.md`** — v2 snapshot + backlog

---

## Verification checklist

- [ ] Allowlisted new user: can set password with invite code, lands on **`/dashboard`**.
- [ ] Returning user: email + password only; session persists refresh.
- [ ] Forgot password: email arrives, link completes, new password works.
- [ ] Non-allowlisted email: cannot create user or sign in (clear error).
- [x] Dashboard: recent edits and my cards lists wired (confirm rows still match DB for **`auth.uid()`** after deploy).
- [x] Edit history shows **display names**; “only my edits” toggle; editor links to **`/profile/{uuid}`**.
- [ ] Workbench save still writes **`edit_history.edited_by`** (regression check when changing auth).
- [x] **`/profile`** display name + avatar upload (after **`014`** on Supabase); **`/profile/:userId`** read-only teammate view.

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
| 2026-04-17 | **`014_storage_avatars.sql`** + **`uploadProfileAvatar`** / **`removeProfileAvatar`**; **`ProfilePage`** avatar UI; route **`/profile/:userId`** + **`fetchProfileById`**; **`EditHistoryPage`** editor → profile links; **`DashboardPage`** card links → **`/?card=…`**; docs + **`CLAUDE.md`** (commit `5ddf493` on `v2/supabase-migration`). |

**Still manual / follow-up:** On **each** Supabase project: run **`013`** and **`014`** if not already; deploy **`invite-set-password`** (and **`request-magic-link`** if still used); confirm **Email** provider + redirect URLs + Edge secrets; smoke **Vercel** (login, dashboard, profile, avatar upload, history links). Revisit **Phase 11** cleanup when magic link is fully retired.

---

*Created: 2026-04-18 — complements `user-profiles-and-activity.md` for dashboard + password-primary auth. Last context sync: 2026-04-17.*
