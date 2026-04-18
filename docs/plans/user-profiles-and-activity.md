# Plan: User profiles, profile page, and activity (v2)

**Status (2026-04-17):** **Phases 1–5 implemented** on branch `v2/supabase-migration` (profiles, dashboard, history UX, `created_by`, teammate profile route, avatars + Storage). **Ops:** apply migration **`014_storage_avatars.sql`** in the Supabase project before avatar upload works in that environment.

**Audience:** Future AI agents / developers.  
**Companion context:** Root `CLAUDE.md` (project state, branches).

**Auth direction:** Primary sign-in is moving to **email + password** + dashboard; see **`docs/plans/user-dashboards-and-password-auth.md`**. This document remains the source for **`profiles`**, **`edit_history` display names**, **`created_by`**, **`/profile`**, and **avatars**.

## Why this exists

Collaborators are not highly technical. A **visible profile** (display name, optional photo, one clear **Profile** screen) improves trust and orientation. Profiles sit on top of `auth.users` (magic link, password, or other Supabase auth).

## Already in the schema (do not reinvent)

| Piece | Location | Notes |
|--------|-----------|--------|
| Edit attribution | `edit_history.edited_by` → `auth.users(id)` | `004_create_edit_history.sql` |
| App writes `edited_by` | `src/data/supabase/appAdapter.js` | Current session user id when logging edits |
| Card attribution | `cards.created_by` → `auth.users(id)` | `001_create_cards.sql`; manual insert paths set this in app adapter |
| Profiles | `013_profiles.sql` | `profiles` + RLS + `handle_new_user` trigger + backfill |
| Avatars bucket | `014_storage_avatars.sql` | Bucket `avatars`, public URLs, write RLS to own `{user_id}/…` prefix |

## Product goals (implementation checklist)

| # | Goal | Status |
|---|------|--------|
| 1 | **`profiles` table** — `id = auth.users.id`, **`display_name`**, optional **`avatar_url`**, timestamps | Done (`013`) |
| 2 | **RLS** — Authenticated **read** all profiles; **insert/update** only own row | Done (`013`) |
| 3 | **Auto row** — Trigger on `auth.users` after insert | Done (`013`) |
| 4 | **`/profile`** — Email read-only, edit **display_name** | Done (`ProfilePage.jsx`) |
| 5 | **`/profile/:userId`** — Read-only teammate view (valid UUID); invalid param → `/profile` | Done |
| 6 | **Nav** — Link to Profile from `AuthUserMenu` | Done |
| 7 | **Edit history** — Join **`profiles.display_name`** for editors; **“Only my edits”** | Done (`EditHistoryPage.jsx`) |
| 8 | **“My cards” / dashboard** — **`created_by`** on manual cards; **`/dashboard`** lists recent edits + cards | Done |
| 9 | **Avatars** — Supabase Storage **`avatars`** bucket + upload/remove on own profile | Done (app + **`014`**; DB must run **`014`**) |
| 10 | **Deep links** — History **Editor** → `/profile/{edited_by}`; dashboard card links → `/?card=…` | Done |

## Explicit non-goals (for this plan)

- **Global uniqueness** of display names (email remains identity).
- **Public anonymous** profile directory (only signed-in teammates see names/photos as designed).

## Implementation phases (original estimates)

| Phase | Scope | Status |
|-------|--------|--------|
| **1** | Migration: `profiles` + RLS + trigger; backfill | Done — `013_profiles.sql` |
| **2** | `/profile` + TanStack Query + nav | Done |
| **3** | Edit history: display names + “my edits” | Done |
| **4** | `created_by` on inserts; “My submitted cards” / dashboard | Done |
| **5** | Avatars via Storage + upload UI | Done — `014_storage_avatars.sql` + `uploadProfileAvatar` / `removeProfileAvatar` + `ProfilePage` |

## Decisions (confirmed in implementation)

- **Display name:** optional; trimmed; max **120** characters in UI; not globally unique.
- **Visibility:** all **authenticated** users may read others’ profile row (display name + avatar URL for small team).
- **Avatar files:** JPEG, PNG, WebP; **1 MB** max client-side; stored at **`{user_id}/avatar`** in bucket **`avatars`** (upsert); **`profiles.avatar_url`** holds public URL.

## Auth context

- **Login:** `/login` — invite allowlist + Edge Function `request-magic-link` when using magic-link flow; password sign-in per dashboard/auth plan.
- **Callback:** `/auth/callback` — client may use **`flowType: 'implicit'`** in `src/lib/supabaseClient.js` for cross-device magic links (see auth plan).
- **Migrations:** `012_signup_allowlist.sql`; `supabase/config.toml` sets `verify_jwt = false` for that function.

## Key files

| Area | Files |
|------|--------|
| SQL | `supabase/migrations/013_profiles.sql`, `014_storage_avatars.sql` |
| Routes | `src/App.jsx` — `/profile`, `/profile/:userId`, `/dashboard` |
| UI | `src/pages/ProfilePage.jsx`, `src/pages/DashboardPage.jsx`, `src/pages/EditHistoryPage.jsx` |
| Data | `src/data/supabase/appAdapter.js` — `fetchProfile`, `fetchProfileById`, `upsertProfile`, `uploadProfileAvatar`, `removeProfileAvatar`, edit history helpers, card inserts + `created_by` |
| Router | `src/db.js` — re-exports above |

## Verification checklist

- [ ] New user after invite: profile row exists (trigger on signup).
- [ ] **Apply `014`** in Supabase: bucket `avatars` exists; upload from `/profile` succeeds; image loads via public URL.
- [ ] Edit in Workbench / Batch: `edit_history.edited_by` populated; history shows **display name**; editor links to `/profile/{uuid}`.
- [ ] “Only my edits” matches session user.
- [ ] Custom/manual card: `created_by` set; dashboard “My submitted cards” correct.
- [ ] **`/profile/{teammateUuid}`** read-only; own UUID on same route still shows **edit** UI (treated as “my profile”).

## Optional follow-ups (not required)

- Show tiny avatars next to editor names on **Edit history** table.
- **Private** bucket + signed URLs instead of public URLs (stricter; more client work).

---

*Last updated: 2026-04-17 — aligned with repo (`013`, `014`, Profile / Dashboard / History / Storage UI).*
