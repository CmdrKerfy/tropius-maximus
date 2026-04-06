# Plan: User profiles, profile page, and activity (v2)

**Status:** Approved by owner; **implementation paused** — resume on branch `v2/supabase-migration`.  
**Audience:** Future AI agents / developers picking up after a break.  
**Companion context:** Root `CLAUDE.md` (project state, branches, phases).

## Why this exists

Collaborators are not highly technical. A **visible profile** (display name, one clear **Profile** screen) improves trust and orientation more than adding passwords. **Magic link + session persistence** remains the auth model; profiles sit on top of `auth.users`.

## Already in the schema (do not reinvent)

| Piece | Location | Notes |
|--------|-----------|--------|
| Edit attribution | `edit_history.edited_by` → `auth.users(id)` | `004_create_edit_history.sql` |
| App writes `edited_by` | `src/data/supabase/appAdapter.js` | Uses current session user id when logging edits |
| Card attribution | `cards.created_by` → `auth.users(id)` | `001_create_cards.sql` — verify all manual/custom insert paths set this |

## Product goals

1. **`profiles` table** — `id = auth.users.id`, human **`display_name`**, optional **`avatar_url`**, timestamps.
2. **RLS** — Authenticated users can **read** all profiles (small team, show names on history). Users may **insert/update only their own** row.
3. **Auto row** — Prefer DB trigger on `auth.users` **after insert** to create `profiles`; or lazy upsert on first profile visit (trigger is cleaner).
4. **`/profile` route** — Show email (read-only from session), edit **display_name**, short copy: stay signed in until sign out / magic link when session gone.
5. **Nav** — Link from `AuthUserMenu` (or equivalent) to Profile.
6. **Edit history UX** — Join **`profiles.display_name`** for `edited_by` instead of raw UUIDs; optional filter **“Only my edits”** (`edited_by = auth.uid()`).
7. **Optional “My cards”** — After confirming inserts set **`cards.created_by`**, list recent cards for current user on profile or sub-route.

## Explicit non-goals (for this plan)

- Replacing magic links with username/password (optional later; not required for “easier” UX here).
- Public sign-up (keep invite allowlist + Edge Function gate unless product changes).

## Implementation phases (effort estimates)

| Phase | Scope | Effort (indicative) |
|-------|--------|---------------------|
| **1** | Migration: `profiles` + RLS + trigger (or documented upsert); backfill SQL for existing `auth.users` | 0.5–1.5 days |
| **2** | `/profile` page + TanStack Query mutation + nav link | 0.5–1 day |
| **3** | Edit history: resolve display names + “my edits” filter | 0.5–1 day |
| **4** | Audit card insert paths; `created_by`; “My submitted cards” UI | 0.5–1 day (+ if inserts missing) |
| **5** (optional) | Avatars via Supabase Storage + upload UI | 1–2 days |

## Decisions to confirm with owner before coding

- **Display name:** required vs optional; max length; **not** globally unique (email remains identity).
- **Visibility:** all authenticated users may read others’ `display_name` (recommended for 1–3 people).
- **Backfill:** one-off SQL `INSERT INTO profiles ...` for users that already exist before trigger exists.

## Auth context (magic link + invite)

- **Login:** `/login` → Edge Function `request-magic-link` (`supabase/functions/request-magic-link/`) checks `INVITE_SECRET` + `signup_allowlist`.
- **Callback:** `/auth/callback` — browser client uses **`flowType: 'implicit'`** in `src/lib/supabaseClient.js` so email links work when opened in a **different** browser/device than the one that requested the link (PKCE would require same-browser verifier).
- **Migrations:** `012_signup_allowlist.sql`; `supabase/config.toml` sets `verify_jwt = false` for that function.

## Key files to touch when implementing

- New migration: e.g. `013_profiles.sql` (number after latest in repo).
- `007_create_rls_policies.sql` pattern for RLS style reference; may add policies in new migration.
- `src/App.jsx` — route `/profile`.
- `src/components/AuthUserMenu.jsx` — link to profile.
- `src/data/supabase/appAdapter.js` — `fetchProfile`, `upsertProfile`, optional `fetchEditHistoryForUser` / join helpers.
- `src/pages/EditHistoryPage.jsx` — names + filter.
- Card creation paths in `appAdapter.js` (or related) — set `created_by`.

## Verification checklist after build

- [ ] New user after invite: profile row exists (trigger or first visit).
- [ ] Edit in Workbench / Batch: `edit_history.edited_by` populated; history shows **display name**.
- [ ] “Only my edits” matches session user.
- [ ] Custom/manual card: `created_by` set when applicable; “My cards” list correct.

---

*Last updated: 2026-04-06 — plan saved for paused work; see `CLAUDE.md` “Paused work & backlog”.*
