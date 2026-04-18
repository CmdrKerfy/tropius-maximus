# Plan: Custom card flow — Supabase-only (decouple GitHub PAT)

**Goal:** When the app runs against **Supabase** (`VITE_USE_SUPABASE=true`), **custom card create** should have **one** clear story: save to **Postgres**. No implied dependency on PAT/GitHub for “sync” or success messaging.

**Status:** Implemented on **`v2/supabase-migration`**: Supabase builds skip GitHub commit paths and PAT-dependent success copy (`CustomCardForm` lazy-loads `github.js` only on DuckDB; Explore hides PAT UI when `VITE_USE_SUPABASE=true`; **`SqlConsole`** read-only + hides local “commit” strip on Supabase). `github.js` remains for v1 / DuckDB.

**Context (resolved for Supabase):** `CustomCardForm` inserts via `addTcgCard` / `addPocketCard` only; DuckDB mode may still `commitNewCard` when a PAT exists. Explore **Custom cards** copy no longer references GitHub sync on the Supabase path.

---

## Problem statement

| Current behavior | Issue |
|------------------|--------|
| `commitNewCard` runs after DB insert if PAT set | Redundant; duplicates mental model (git vs DB) |
| Success without PAT: “added locally… set PAT” | **Wrong** for Supabase — card is in the cloud DB |
| PAT UI in Explore | Confuses non-technical users; v2 collaboration is **RLS + auth**, not PAT |

---

## Recommended approach

**Single rule:** If `useSupabaseBackend()` (mirror `src/db.js`: `VITE_USE_SUPABASE` + URL + anon key), **do not** call `lib/github` from `CustomCardForm` for the create path. **Do not** show PAT-dependent success/failure for that path.

**Keep v1 path:** When **not** on Supabase (DuckDB / local), **keep** existing PAT + `commitNewCard` behavior unchanged for anyone still using the static site workflow.

---

## Implementation phases

### Phase 1 — `CustomCardForm.jsx` (core)

1. **Detect backend** — Import or duplicate a small helper (e.g. same condition as `db.js` `useSupabaseBackend`) so the component knows Supabase vs DuckDB.
2. **After successful `addTcgCard` / `addPocketCard`:**
   - **Supabase:** Skip `getToken()` / `commitNewCard` entirely. Set success to something like: **“Card saved to the database.”** (or “Saved — it will appear in Explore shortly.”)
   - **DuckDB:** Keep current block: PAT → `commitNewCard`, existing messages.
3. **Remove or guard misleading UI** — The bottom note **“No GitHub PAT configured — this card will only save locally…”** when `!getToken()` should **not** show for Supabase (or replace with neutral: “You must be signed in to save” if you add an explicit check later).
4. **Imports** — `commitNewCard` / `getToken` only when needed, or use dynamic `if (!isSupabase) { ... }` to avoid bundling noise (optional).

**Files:** `src/components/CustomCardForm.jsx` (primary).

**Acceptance:** With Supabase env, submit a custom card → **no** GitHub network calls; message reflects DB save. With DuckDB-only build, behavior unchanged.

---

### Phase 2 — Explore “Custom Cards” panel (PAT UX)

1. **When Supabase:** Hide the **GitHub PAT** subsection (input, “Add PAT”, “configured” badge) **or** collapse it behind **“Advanced (legacy v1 sync)”** with a short line: *Not used when connected to Supabase.*
2. **Delete / bulk actions** that mention “remove from GitHub” — **grep** `ExplorePage.jsx` for `getToken`, `deleteCardsFromGitHub`, etc. Either:
   - **Supabase:** Only delete via `db` / adapter (no GitHub), and update copy to **“Delete from database”** only, **or**
   - Leave delete logic for a follow-up if it’s still mixed; at minimum **don’t** tell users they need a PAT to delete.

**Files:** `src/pages/ExplorePage.jsx` (and any other page that embeds PAT + custom cards).

**Acceptance:** Non-technical user on Vercel + Supabase does **not** see PAT as required for adding cards.

---

### Phase 3 — Optional follow-ups (defer if time-constrained)

- **`src/lib/github.js`:** No removal yet — may still be used on **`main`** / v1. **Do not delete** until v1 cutover is explicit.
- **Docs:** One line in `CLAUDE.md` or README under v2: *Custom cards are created in Supabase; no repo PAT.*
- **`created_by`:** Done in `appAdapter.addTcgCard` / `addPocketCard` (Supabase manual inserts).

---

## Verification checklist

- [ ] Supabase: create TCG + Pocket custom card → row in `cards` (and related), no `commitNewCard` in network tab.
- [ ] DuckDB/local (if still tested): PAT path still works.
- [ ] No success message implying “local only” when using Supabase.
- [x] Explore: PAT panel hidden when Supabase; GitHub annotation sync banner hidden on Supabase.
- [x] SqlConsole: Supabase note + block mutations; no GitHub commit path; PAT confirm copy guarded.

---

## Relation to other plans

- **`docs/plans/user-profiles-and-activity.md`** — **`created_by`** on Supabase manual card inserts is **shipped** in **`appAdapter.js`** (see profiles plan / dashboard). This custom-card doc is independent for PAT/copy cleanup.

---

*Created: 2026-04-06 — aligns with recommendation: Supabase as single write path for custom cards.*
