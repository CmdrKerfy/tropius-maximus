# Plan: `unique_id` annotation cleanup (defer)

**Goal:** Stop treating **`annotations.unique_id`** as a second identifier when it duplicates **`cards.id`**. Use **`cards.id`** as the single canonical ID in UI and new code; optionally simplify stored data once callers are updated.

**Status:** **Tracked — not started.** Revisit after higher-priority v2 work (cutover, E2E, profiles/dashboards as planned).

---

## Problem

- **`unique_id`** is a **legacy v1** field on annotations (flat JSON / DuckDB era). It often mirrors **`cards.id`** and adds confusion (“Unique ID” vs primary key).
- Supabase **`fetchCard`** still backfills `annotations.unique_id = cards.id` when missing so older UI keeps working (`src/data/supabase/appAdapter.js`).
- References may remain in **CardDetail**, pins, **AnnotationEditor** filters, DuckDB paths, and **`public/data/custom_cards.json`** for historical rows.

---

## Out of scope (for this plan)

- Changing **`cards.id`** or **`generate_card_id`** rules — already aligned with normalized number storage elsewhere.
- Dropping the **`annotations.unique_id`** column without a migration design — only after audit of reads/writes.

---

## Proposed approach (when picked up)

1. **Inventory** — Grep for `unique_id` in `src/`, scripts, and JSON samples; list every read path (UI, export, search, pins).
2. **UI** — Show **`cards.id`** (or one read-only “Card ID”) where “Unique ID” today binds to `unique_id`; avoid duplicate editable fields.
3. **Writes** — Stop persisting redundant `unique_id` on save when it equals `cards.id`, or stop including it in payloads if the column can be nullable / deprecated later.
4. **Data (optional)** — One-time SQL or script: set `unique_id` NULL where `unique_id = card_id` join, or leave as-is if column is kept for backward compatibility.
5. **v1 / DuckDB** — If Pages + DuckDB remain in use, mirror the same “single source” rule or document that v1 is read-only for IDs.

---

## Risks

- Anything that **searches, exports, or pins** by the string **`unique_id`** must be updated in the same change set.
- **`extra` JSONB** — confirm no duplicate key lives only in dynamic fields.

---

## Primary files (starting points — verify when implementing)

- `src/data/supabase/appAdapter.js` — `fetchCard` backfill; annotation save paths
- `src/components/CardDetail.jsx` — “Unique ID” display / edit
- `src/components/AnnotationEditor.jsx` — filtered fields
- `src/components/CardDetailFieldControl.jsx` — pinnable keys if `unique_id` is listed
- DuckDB / `db.js` branches if still used on `main`
