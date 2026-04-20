# Plan: Add / edit card workflow hardening (review)

**Status:** **Phases 1–6 implemented** in app code. **Phase 7** — **implemented:** Postgres `apply_annotation_with_history` RPC (`017_apply_annotation_with_history.sql`) writes annotations + `edit_history` in **one transaction**; client uses `ANNOTATION_ROW_INSERT_DEFAULTS` + merged row for RPC. **Phase 8** — Explore clarifies DuckDB/local vs PAT. **Phase 9** — close on missing card after failed save + **Supabase** tab `visibilitychange` refetch when safe.

**Goal:** Address friction, misleading UI, and data-integrity gaps in custom card creation, inline annotation edits (Explore), Workbench `AnnotationEditor`, batch updates, and related Supabase paths.

**Related (future Batch UX):** **`docs/plans/batch-redesign-visual-selection.md`** — visual selection + wizard + explicit review; apply path should remain **per-card `apply_annotation_with_history`** for audit parity with this plan.

**Branch / rollout:** **`v2/supabase-migration`**. **Apply:** migration **`017_apply_annotation_with_history.sql`** for transactional saves; optimistic locking still uses existing `annotations.version`.

---

## Scope summary

| Tier | Themes |
|------|--------|
| **High** | Failed-save UI truth; concurrent edit conflicts |
| **Medium** | Custom card identity fields; bad image URLs; delete semantics; session-expiry clarity; batch safety |
| **Low** | Edit-history durability; v1 sync messaging; stale detail panel |

---

## Phase 1 — High: Save failures must not lie

**Implemented:** `AnnotationEditor` reverts failed fields from `serverSnapshotRef`; `CardDetail` refetches on failed Supabase saves.

---

## Phase 2 — High: Concurrent edits (optimistic locking)

**Implemented (`src/data/supabase/appAdapter.js`):**

- **`patchAnnotations`** no longer blind `upsert`s.
- **Insert** when no annotation row (retries on `23505` insert race).
- **Update** when a row exists: RPC applies version-checked `UPDATE` (same semantics as before); if **0 rows** updated → Postgres raises → client maps to `ANNOTATION_VERSION_CONFLICT_MESSAGE` (see `isAnnotationVersionConflictFromRpc` — checks `message` / `details` / `hint` and code `P0001`).
- Export: `ANNOTATION_VERSION_CONFLICT_MESSAGE` for callers/tests.

**Workbench:** On conflict, `AnnotationEditor` calls **`fetchAnnotations(cardId)`** to resync the whole form; other errors still revert the single field.

**Human copy:** `humanizeError` maps `ANNOTATION_VERSION_CONFLICT` to plain English.

---

## Phase 3 — Medium: Custom card form

**3.1** — Clearer missing Set ID (TCG) + **inline help** boxes on TCG full + quick layouts (Set ID + Source behavior).

**3.2** — If the image preview failed (`imageError`) **and** a URL is present, **`confirm`** before save; cancel throws `SAVE_CANCELLED` (no error toast). `runSaveIntent` / duplicate modal ignore that cancel.

---

## Phase 4 — Medium: Delete card semantics

**Implemented:** `CardDetail` — if `deleteCardsById` returns **0** rows, **`toastError`** explains manual-only / permission. (Delete button still only for `is_custom`.)

---

## Phase 5 — Medium: Session / auth copy

**Implemented:** `humanizeError` — **401** message now mentions opening **Log in** from the menu.

---

## Phase 6 — Medium: Batch edit safety

**Implemented (`BatchEditPage`):** When **`total ≥ 25`**, user must **type the exact match count** (same digits as “Matching cards”). Checkbox for **> 75** unchanged. Button disabled until count matches.

**Follow-up (UX):** After a batch run, **per-card errors** show in an **open** details block: **card name** when that id appears in the Explore **preview** sample, otherwise **id** + message (see `previewNameById` on `BatchEditPage`).

---

## Phase 7 — Low: Edit history durability

**Implemented:** `public.apply_annotation_with_history` (migration **`017_apply_annotation_with_history.sql`**) runs **INSERT or version-checked UPDATE** on `annotations` and **INSERT** into `edit_history` in a **single transaction**. `patchAnnotations` calls `supabase.rpc` with a **full merged** `p_row` (insert: `{ ...ANNOTATION_ROW_INSERT_DEFAULTS, ...row }`; update: `{ ...cur, ...row }`) and a JSON array of history entries (same shape as before, without `edited_by` — set in SQL via `auth.uid()`). **Grant:** `EXECUTE` for authenticated. On **0 rows** updated → same `ANNOTATION_VERSION_CONFLICT` message as before; **23505** on insert still triggers the existing retry loop. **Client:** `isAnnotationVersionConflictFromRpc` treats PostgREST `message` / `details` / `hint` and Postgres code **`P0001`** as the same conflict.

---

## Phase 8 — Low: v1 DuckDB + GitHub

**Implemented (`ExplorePage`, DuckDB / v1 path):** Under the **“No GitHub PAT”** notice, copy clarifies that **without a PAT**, custom cards and edits stay **browser-local** (DuckDB / v1 workflow), not Supabase. Supabase deployments hide this block when `VITE_USE_SUPABASE` is on.

---

## Phase 9 — Low: Stale card detail

**Implemented:** `CardDetail` — if refetch after a failed save fails with **not found / pgrst116 / 0 rows**, **`onClose`** runs so the modal does not stay open on a removed card.

**Implemented (Supabase):** On **`visibilitychange`** → **visible**, **`fetchCard(cardId, source)`** refreshes the open card unless the user is mid-edit (`isEditMode`, `editingImage`, `loading`, `imageEnlarged`) so in-flight edits are not stomped.

---

## Open questions (resolved in code)

1. **Conflict policy:** **Optimistic locking** (version in `WHERE` clause).
2. **Batch:** Typed count for **≥ 25** cards; **> 75** still requires checkbox.
3. **Image gate:** **Confirm dialog** (not a hard block).
4. **History + transaction:** **RPC** `apply_annotation_with_history` (Phase 7).

---

## References

- `supabase/migrations/017_apply_annotation_with_history.sql` — transactional RPC
- `src/data/supabase/annotationBridge.js` — `ANNOTATION_ROW_INSERT_DEFAULTS`
- `src/data/supabase/appAdapter.js` — `patchAnnotations` → RPC, `ANNOTATION_VERSION_CONFLICT_MESSAGE`, `isAnnotationVersionConflictFromRpc`, `buildEditHistoryPayload`
- `src/components/AnnotationEditor.jsx` — conflict refetch
- `src/components/CardDetail.jsx` — delete toast, refetch + close on missing card, visibility refetch (Supabase)
- `src/pages/ExplorePage.jsx` — DuckDB “no PAT” local vs Supabase copy
- `src/components/CustomCardForm.jsx` — image confirm, help text, `SAVE_CANCELLED`
- `src/pages/BatchEditPage.jsx` / **`BatchWizard.jsx`** — typed count confirmation; batch error names; saved-list wizard (**`batch-redesign-visual-selection.md`**)
- `src/pages/DashboardPage.jsx` / `EditHistoryPage.jsx` — copy: edits vs submitted cards vs add session log
- `src/lib/humanizeError.js` — conflict + 401 copy
