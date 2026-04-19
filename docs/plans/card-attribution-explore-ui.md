# Plan: Card attribution in Explore (created by / last annotation edit)

**Status:** **Shipped** (Explore detail, grid tooltip, Workbench).  
**Audience:** Owner, implementers, AI agents.  
**Companion:** `docs/plans/user-profiles-and-activity.md` (profiles, `created_by`, edit history patterns), root `CLAUDE.md`.

---

## Goal

Let signed-in collaborators see **who submitted** a manual/custom card and **who last updated annotations** (or when), in a **non-obtrusive** way—primarily in the **card detail** experience, with **optional** lighter cues in the grid.

## Non-goals (initial ship)

- Showing attribution on **every** grid tile by default (noise + query cost at 15k+ cards).
- Field-level “who edited this field” inline on each control (use **Edit history** / `edit_history` for that).
- Changing ingest/API card rows where `created_by` is null (API-sourced cards): UI should **hide** or show “System / API” copy, not invent users.
- Email addresses in primary UI.

## What already exists (reuse; no new tables required)

| Data | Location | Notes |
|------|-----------|--------|
| Card creator | `cards.created_by` → `auth.users(id)` | Set for manual inserts in `appAdapter` |
| Annotation last writer | `annotations.updated_by`, `annotations.updated_at` | `002_create_annotations.sql` — confirm app sets `updated_by` on `patchAnnotations` / writes |
| Display names | `public.profiles` (`display_name`, etc.) | `013_profiles.sql`; read RLS for authenticated users |
| Fine-grained edits | `edit_history` | Already surfaced on **History** page with editor names |

**Prerequisite check before build:** Verify `patchAnnotations` (or equivalent) **sets `annotations.updated_by`** on each successful save. If not, add that in the same effort so “last edited by” is truthful.

---

## UX specification (recommended)

### A. Card detail (Explore drawer / `CardDetail`)

- Add a **single muted line** (e.g. `text-xs text-gray-500`) below the title row or at the bottom of the header strip, e.g.  
  `Added by {name} · Annotations last updated {relative time} by {name}`  
  Omit segments when data is missing (e.g. no annotation row yet → only “Added by…” or hide annotation half).
- Link **names** to `/profile/{userId}` where `userId` is the UUID (matches existing teammate profile route pattern).
- For cards with **no** `created_by` (API ingest): show nothing, or **“Sourced from API”** only if product wants clarity—avoid fake users.

### B. Grid (optional / phase 2)

Pick **one**:

1. **No grid attribution** (simplest; detail-only).  
2. **Tooltip on hover** on the card image/title: same one-line summary (lazy: fetch on hover only if not in list payload).  
3. **Optional column** (future): user-toggle “Created by” in a denser admin-style table—out of scope unless requested.

Default recommendation: **1** for v1, **2** only if owners want grid context without clutter.

### C. Workbench

- **`CardAttributionLine`** is mounted on **Workbench** (parity with Explore detail). Reuses `fetchCard` attribution fields.

---

## Technical approach

### 1. Data loading

- **`fetchCard`**: Ensure response includes `created_by`, and embedded annotation includes `updated_by`, `updated_at` (Supabase `select('*, annotations(*)')` already returns columns; confirm **frontend merged object** does not strip them—today the TCG return object lists explicit fields and may **drop** `created_by`; adjust so clients receive attribution fields when present).
- **Display names**: Resolve UUIDs → `display_name` via one of:
  - **Batch query** `profiles` for distinct ids in the response, or  
  - **Small RPC** `get_display_names(uuid[])` returning `id → display_name` (cleaner if many ids later).
- **Fallback:** If profile missing, show shortened id or “Unknown user” (never block render).

### 2. API surface (`appAdapter.js` + `db.js`)

- Add a small helper, e.g. `resolveProfileLabels(userIds)` used by `fetchCard` (and optionally by list endpoints if grid phase uses it).
- Keep **RLS-safe** reads: only what `profiles` policy already allows for authenticated users.

### 3. UI

- New tiny presentational component, e.g. `CardAttributionLine.jsx`, used from `CardDetail.jsx` (and nowhere else in v1 if grid is deferred).
- Use existing **relative time** utility if one exists; otherwise `Intl.RelativeTimeFormat` or a minimal helper.

### 4. Privacy / product

- Only render for **authenticated** sessions (same as rest of v2 app).
- No new PII: display name only, consistent with History page.

---

## Phasing (for execution)

| Phase | Scope | Deliverable |
|-------|--------|----------------|
| **1** | Schema/app check + `fetchCard` payload | `created_by`, `updated_by`, `updated_at` reliably available on client; `patchAnnotations` sets `updated_by` if missing |
| **2** | Profile name resolution | Helper + `CardAttributionLine` in **Card detail** only |
| **3** (optional) | Explore grid | Tooltip or icon + lazy fetch, **or** defer |

---

## Risks / mitigations

| Risk | Mitigation |
|------|------------|
| List endpoint join explosion | Keep attribution **off** default grid; batch profile fetches |
| Missing `updated_by` on old rows | Show time-only or “Unknown”; backfill optional, not required for v1 |
| DuckDB / offline mode | Hide attribution or “N/A” when no Supabase user context (match existing patterns) |

---

## Exit criteria (done = shippable)

- [ ] Manual cards show **Added by** with correct profile link when `created_by` present.  
- [ ] When annotations exist and `updated_by` / `updated_at` present, show **last annotation update** line without cluttering the main form.  
- [ ] API-sourced cards do not show misleading creator names.  
- [ ] Build passes; no new secrets; RLS unchanged or tightened only if a new RPC is added (document in migration if needed).

---

## Files likely to touch

- `src/data/supabase/appAdapter.js` — `fetchCard` return shape; optional `resolveProfileLabels`; `patchAnnotations` if `updated_by` missing  
- `src/components/CardDetail.jsx` — mount attribution line  
- New: `src/components/CardAttributionLine.jsx` (or inline if truly trivial)  
- `src/db.js` — re-exports if needed  
- Optional migration: **only** if an RPC is preferred over client-side `profiles.in(...)`

---

## Ordering vs other work

- Fits **after** profiles + History patterns are stable (they are on v2 branch per `user-profiles-and-activity.md`).  
- Independent of **Part B** custom card form; can ship in parallel.

---

## Check in later

- **Batch edit page (`/batch`) — attribution parity (optional).** Same `CardAttributionLine` (or compact variant) when previewing a card or the batch UI shows per-card context—only if real workflows need “who added / last edited” there; avoid extra queries per row. Revisit on a future pass after Batch usage is clearer.
