# Batch redesign — visual selection, review, and apply

**Status:** **Shipped in app code (v2 branch)** — `localStorage` list, Explore selection + bar + add-all-matching, Card detail add/remove, **`BatchWizard`** on **`/batch`** (field → review → confirm → apply + retry + post-run list prompt). **Phase 7:** URL-scoped batch UI and **`BatchQuickAnnotationScope`** removed. **Curated append:** optional checkbox on custom **select** / **multi_select** fields — after at least one successful card write, appends batch value(s) to **`field_definitions.curated_options`** (case-insensitive dedupe) via **`appendCuratedOptionsForCustomField`** in **`appAdapter.js`** (built-in fields cannot be updated per RLS).

**Decisions captured (2026):** **`localStorage`** batch list (simplest anti–data-loss default), **visual selection** persisting across Explore pages/filters, **toggleable select-all** = all cards matching current Explore filters **up to existing hard cap** (explicit UI copy), **one field per run** with **free-typed values** and optional **“add to global curated options”** (Field Management permissions), **mandatory review** (before→after only when overwriting) + **separate confirm**, **progress** + **retry failed only** + optional copy failed IDs, post-run **prompt clear vs keep list**, **per-card `edit_history`** (same RPC as single edits). **Not** married to Explore URL for scope. Entry points: **Explore grid** + **Card detail**.

**Context doc:** **`CLAUDE.md`** (Batch redesign + curated append shipped).

## Goal

Replace URL-coupled Batch with a flow that matches how annotators actually work: **build a card set visually** (selection persists across Explore pages/filters), **choose one annotation field and a value** (including values not yet in dropdowns), **review with explicit consent** (before→after when overwriting), then **apply with progress** and **retry failed only**. Selection survives refresh via **`localStorage`** (simplest “don’t lose work” default).

## Non-goals (v1)

- Cross-device sync: **`024_batch_selections.sql`** + `useBatchSelection` (signed-in, non-anonymous only); anonymous stays localStorage-only.
- Multi-field batch updates in one run (still **one attribute per batch run**).
- Automatic apply after review (always **manual confirm**).
- Replacing Workbench or Explore detail editing for one-off cards.

## User-facing flow (high level)

1. **Build list** — On **Explore** (grid) and **Card detail**, user adds/removes cards. Selection persists when paginating, changing sort, or changing filters (selected IDs are independent of current query). User can **clear the entire list** anytime.
2. **Optional: Select all matching** — User can turn on **“Select all matching cards (up to the safety cap)”** for the **current Explore result set** (current search + filters), **not** “this page only.” UI copy states the cap behavior explicitly.
3. **Batch workspace** — User opens **Batch** (dedicated route or stepped UI). Chooses **one field** (any field the app can persist via the normal annotation save path: typed columns + `extra` / `field_definitions`).
4. **Value** — User sets **set / clear** and enters a value. For curated select/multi-select fields: default is **batch-only** typed value; optional checkbox **“Also add this value to the field’s curated options”** (only if user has permission consistent with Field Management; idempotent append).
5. **Review** — Read-only summary: count, field, mode, value. **Card preview**: collapsible thumbnail grid and/or list. **Before → after** shown **only when overwriting** a non-empty existing value on a card (sanity check). No apply on this screen.
6. **Confirm** — Separate explicit action (button + short acknowledgment text). Warn if count hits **hard cap** (keep existing cap for now): explain that only up to **N** cards will be processed in this run and user must **narrow filters / split** for the remainder.
7. **Apply** — Determinate **progress** (processed/total), then **success/partial/fail summary**. **Edit history**: continue using the existing per-card transactional RPC path so **each successful card** produces the same style of **`edit_history`** entry as manual saves (audit best practice).
8. **After run** — Prompt: **Clear batch list** vs **Keep selection** (for another field pass). Offer **Retry failed only** (default remediation) plus expandable per-card errors; optional **copy failed IDs** for edge cases.

## Data & persistence

### `localStorage` contract

- **Key:** e.g. `tm_batch_card_ids` (prefix with env or user id if available: `tm_batch_card_ids:${userId}` to avoid collisions on shared machines).
- **Value:** JSON `{ version: 1, ids: string[], updatedAt: string }` (cap array length at **hard cap + buffer** policy: store only up to cap, or store all and truncate at apply—pick one and document; prefer **store all selected up to cap** and block apply beyond cap with clear messaging).
- **Events:** update on add/remove/select-all/clear; listen to `storage` for **best-effort** multi-tab consistency (optional v1.1).
- **Migration:** if shape changes, bump `version` and reset gracefully.

### Hard cap (v1)

- Keep **`BATCH_EDIT_MAX_CARDS`** (or equivalent) in the adapter.
- **Select-all** and **apply** must both enforce cap with explicit UI:
  - If results > cap: explain that select-all selects **first N** *or* requires narrowing—**choose one behavior and label it** (recommended: **select first N in stable sort order** + banner “Not all results selected—narrow filters to include the rest”).
- **Apply** beyond cap: block with same messaging + suggest split batches.

## UI surfaces

### Explore (`ExplorePage` / grid)

- Checkbox column (or overlay control) per card + header control for select-all semantics.
- Sticky **selection bar**: “**X selected** · Clear · Open Batch · Select all matching (…)”.
- **Select-all** control is **toggleable** (on/off) per product ask; when on, define interaction with manual deselects (recommended: **hybrid set** = union(all matching ids) minus manually removed ids, stored as explicit id list to avoid drift when filters change—document this).

### Card detail (`CardDetail`)

- **Add to batch** / **Remove from batch** (or toggle) visible when Supabase mode + authenticated (same gating as other write features).

### Batch route (`/batch`)

Replace URL-filter batch with a **wizard** (single page with steps or distinct sub-routes—implementation choice):

1. List / count sanity (link back to Explore if empty).
2. Field + value (+ optional curated promotion).
3. Review (+ overwrite previews).
4. Confirm.
5. Running / results.

Decouple from Explore URL for scope (Explore link only for “find more cards”).

## Backend / adapter

- **Reuse** `patchAnnotations` / `apply_annotation_with_history` **per card** inside the apply runner (preserves **edit_history** semantics and conflict handling).
- **Progress:** sequential or small concurrency (start sequential for predictability); report `onProgress(done,total)`.
- **Retry failed:** second pass with only failed IDs from last run (store last failure map in component state until navigation away; optional `sessionStorage` snapshot).
- **Curated promotion:** if checkbox enabled and field supports it, after successful batch (or in same transaction per field—prefer **after batch** to avoid partial option writes when batch aborts): **append** value to `field_definitions.curated_options` for that field key **if** user allowed and RLS permits; **dedupe** case-insensitively.

## Permissions & safety

- **Field Management parity** for “add to global dropdown”: only if current user may edit field definitions (mirror existing `/fields` rules).
- **Review screen** is mandatory; **confirm** is a separate control.
- **RLS / auth errors** surface in failed list with humanized messages (`humanizeError`).

## History / Activity UX (later optional)

- Keep **per-card** `edit_history` rows (source of truth).
- Optional UI grouping: “Batch run affecting N cards” is a **presentation layer** over the same rows (query by time window + user + field patch hash—only if worth the complexity; **defer** unless History feels unusable).

## Testing checklist (manual)

- Select cards across pages/filters; refresh; selection persists (`localStorage`).
- Clear list; card detail add/remove; Explore select-all toggle copy matches behavior.
- Cap: select-all with > cap results; apply blocked/warned as designed.
- Review: overwrite shows before/after; empty→value shows after-only.
- Confirm applies; progress accurate; partial failure → retry failed only succeeds on remaining.
- Curated promotion: checkbox off/on; off does not alter `field_definitions`; on appends once.
- Pocket + TCG cards in same list if allowed (or block with message—decide in implementation based on `patchAnnotations` behavior).

## Implementation phases (suggested order)

1. **Selection infrastructure** — [x] `localStorage` module + hooks; Explore grid checkboxes + bar; clear + **Add all matching** with explicit cap copy; Card detail add/remove; Batch page banner. (`src/lib/batchSelectionStorage.js`, `src/hooks/useBatchSelection.js`, `src/lib/batchLimits.js`, `fetchFirstNMatchingCardIds` in `appAdapter.js`.)
2. **Card detail** — [x] add/remove batch entry.
3. **Batch wizard shell** — [x] step UI on `/batch`; card set = saved ids only (Explore link for discovery).
4. **Field/value step** — [x] shared **`batchEditPatch`** + attribute metadata; free text; optional **curated promotion** checkbox (custom select / multi_select only).
5. **Review + confirm** — [x] thumbnails + overwrite sample; **confirm** step with typed count / large batch checkbox.
6. **Apply runner** — [x] progress; summary; retry failed; clear vs keep list.
7. **Cleanup** — [x] removed URL-scoped **`LegacyUrlBatchPanel`** + **`BatchQuickAnnotationScope`**; **`WorkflowModeHelp`** updated for saved-list workflow.

## Open implementation choices (decide during build)

- **Select-all vs filters changing:** store explicit `Set` of ids vs “rule + exceptions”; recommendation above is **explicit id list** + select-all populates ids once when toggled on.
- **Wizard routing:** one route with internal step state vs `/batch/review` child routes (either is fine; step state is simpler for v1).

## Follow-up backlog

Optional post-ship ideas (server list, History grouping, automation, etc.): **`batch-future-enhancements.md`**.

## References

- Batch cap / id helpers: `BATCH_EDIT_MAX_CARDS`, `fetchFirstNMatchingCardIds`, `fetchMatchingCardIds`, `fetchBatchWizardPreview`, `appendCuratedOptionsForCustomField` in `src/data/supabase/appAdapter.js` (exported via `src/db.js`).
- Per-card save + history: `apply_annotation_with_history` via `patchAnnotations` in `appAdapter.js`.
- Field definitions / curated options: `field_definitions` table + Field Management UI patterns in `src/pages/FieldsPage.jsx` (or equivalent).
