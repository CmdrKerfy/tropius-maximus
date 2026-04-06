# Plan: Custom card flow — Supabase-only (decouple GitHub PAT)

**Goal:** When the app runs against **Supabase** (`VITE_USE_SUPABASE=true`), **custom card create** should have **one** clear story: save to **Postgres**. No implied dependency on PAT/GitHub for “sync” or success messaging.

**Status:** Not started — implement on **`v2/supabase-migration`**.

**Context:** `CustomCardForm.jsx` still calls `addTcgCard` / `addPocketCard` (correct — routes to `appAdapter` insert) **and then** optionally `commitNewCard` when a GitHub PAT exists. Success/error copy still says “local” / “GitHub” like v1 (DuckDB + git). **Explore** still shows a **GitHub PAT** section in Custom Cards settings.

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
- **`created_by`:** If `cards.created_by` should be set on manual inserts, wire in `appAdapter.addTcgCard` / `addPocketCard` (ties into profiles plan later).

---

## Verification checklist

- [ ] Supabase: create TCG + Pocket custom card → row in `cards` (and related), no `commitNewCard` in network tab.
- [ ] DuckDB/local (if still tested): PAT path still works.
- [ ] No success message implying “local only” when using Supabase.
- [ ] Explore: PAT panel hidden or clearly labeled legacy when Supabase.

---

## Relation to other plans

- **`docs/plans/user-profiles-and-activity.md`** — Independent; can ship before or after. **`created_by`** on card insert can link to this plan or profiles Phase 4.

---

*Created: 2026-04-06 — aligns with recommendation: Supabase as single write path for custom cards.*
