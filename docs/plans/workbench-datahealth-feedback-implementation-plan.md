# Plan: Workbench + Data Health + Search feedback implementation

**Status:** Phase 6 implementation complete on branch (manual multi-user QA/sign-off pending)

**Branch:** `v2/supabase-migration`

**Owner decisions captured:**

- Shared Workbench lists should prioritize easiest implementation path for a 3-person collaborator group.
- Lists are private by default; collaborators only see lists the owner explicitly shares.
- Collaborators can edit list content on shared lists, while share/rename/delete remain owner-only controls.
- Batch enqueue cap should match batch list behavior: up to 5,000 cards with warning UX.
- Card rename is manual/custom cards only; API-ingested names remain immutable.
- Renames should appear in history/dashboard tracking.
- Add a new annotation checkbox `jumbo_card` and make it filterable in Explore immediately.
- Explore search should keep one search box and normalize variants (ex/hyphen/spacing behavior).

---

## Rollout strategy

Ship in small phases with **hard pause gates** after each slice. Do not start the next phase until the pause checklist is signed off.

---

## Phase 1 — Data Health deep-link parity (bug)

**Goal:** “Open in Explore” from Data Health returns the same annotation/value cohort shown by Data Health issue cards.

### Scope

- Replace fallback `q` behavior for annotation-value issue deep links with explicit annotation filter params.
- Ensure Explore can parse and apply annotation key/value deep links for all supported issue fields.
- Keep deep-link behavior deterministic (no accidental mismatch from stale local filters).

### Primary file touches

- `src/pages/DataHealthPage.jsx`
  - Extend deep-link builder (`issueExploreHref`) to emit explicit annotation filters.
- `src/pages/ExplorePage.jsx`
  - Parse new deep-link params, apply initial filter state consistently.
- `src/data/supabase/appAdapter.js`
  - Ensure `fetchCards` supports the same annotation field/value semantics used by the deep link.

### QA pause gate (manual)

- From `/health`, open 5+ issue rows across different fields.
- Use “Open in Explore” for each and confirm returned cards match Data Health issue cards for that field/value.
- Confirm no false-empty grid when issue cards exist.

---

## Phase 2 — Artist / Illustrator filter parity (bug)

**Goal:** custom/manual cards tagged with artist data always appear under artist filtering without destructive data merges.

### Scope

- Keep raw columns unchanged (`artist`, `illustrator` stay as-is).
- Normalize filter logic so relevant sources use consistent matching (`artist OR illustrator` where expected).
- Confirm filter options remain stable for existing datasets.

### Primary file touches

- `src/data/supabase/appAdapter.js`
  - Unify artist filter query branches (`TCG`, `Custom`, and `All` handling).
  - Keep current Pocket-specific behavior intact.

### QA pause gate (manual)

- Filter by known artist value in Explore with source set to TCG, Custom, and All.
- Verify manual cards tagged through current custom-card workflow appear.
- Verify Pocket illustrator cards are unchanged.

---

## Phase 3 — Background details cleanup + guardrail (data quality)

**Goal:** fix legacy packed string values and prevent future single-blob regressions.

### Scope

- One-time DB cleanup: convert comma-packed `background_details` strings into normalized arrays.
- Add save-path normalization so UI writes and preserves array form.
- Preserve existing meaningful values; trim/normalize duplicates.

### Primary file touches

- `supabase/migrations/` (new migration; next available number)
  - Data cleanup migration for `annotations.background_details`.
- `src/data/supabase/annotationBridge.js`
  - Guard parsing/normalization for incoming/outgoing annotation rows.
- `src/components/CardDetailFieldControl.jsx`
  - Ensure control always treats `background_details` as multi-value.
- `src/components/CustomCardForm.jsx`
  - Verify create/update paths serialize background details as arrays.

### QA pause gate (manual)

- Reopen cards that previously showed one combined background details value.
- Confirm details render as separate values/chips.
- Edit and save those cards, reload, and verify array shape remains stable.

---

## Phase 4 — Jumbo Card annotation + immediate Explore filter (feature)

**Goal:** support `jumbo_card` as a checkbox annotation and make it filterable in Explore.

### Scope

- Add annotation field `jumbo_card` (boolean style) to schema + form metadata.
- Render checkbox in “Details & annotations (optional)” near Pocket Exclusives.
- Support reading/writing in Card Detail, Workbench editor, and Batch flows.
- Add Explore filter control + query behavior.

### Primary file touches

- `supabase/migrations/` (new migration; next available number)
  - Add annotation field support for `jumbo_card`.
- `supabase/seed.sql`
  - Seed/update `field_definitions` entry if this field is managed there.
- `src/data/supabase/annotationBridge.js`
  - Add bridge key/default handling.
- `src/components/CardDetail.jsx`
- `src/components/CardDetailFieldControl.jsx`
- `src/components/AnnotationEditor.jsx`
- `src/components/CustomCardForm.jsx`
- `src/components/FilterPanel.jsx`
- `src/pages/ExplorePage.jsx`
- `src/data/supabase/appAdapter.js`
  - Fetch/filter wiring for `jumbo_card`.

### QA pause gate (manual)

- Toggle Jumbo Card on custom cards and confirm persistence.
- Filter Explore by Jumbo Card and verify expected rows only.
- Run batch update for Jumbo Card and confirm result + history entries.

---

## Phase 5 — Manual/custom rename with audit tracking (feature)

**Goal:** allow renaming manual cards only while keeping API card names immutable.

### Scope

- Add rename action only for manual cards.
- Enforce backend guard: reject renames on API origins.
- Log rename events into edit history/dashboard activity surface.

### Primary file touches

- `supabase/migrations/` (new migration; next available number)
  - Optional helper RPC/trigger for controlled manual rename + history row.
- `src/data/supabase/appAdapter.js`
  - Add/update rename mutation path and cache invalidation.
- `src/components/CardDetail.jsx`
  - Manual-card-only rename UI.
- `src/pages/DashboardPage.jsx`
- `src/pages/EditHistoryPage.jsx`
  - Ensure rename events are visible with clear labeling.

### QA pause gate (manual)

- Rename a manual card; verify name updates in grid/detail/search while card ID stays unchanged.
- Confirm history/dashboard show rename action.
- Attempt rename on API card and verify blocked behavior.

---

## Phase 6 — Shared Workbench lists v1 + batch enqueue (feature)

**Goal:** replace single default queue dependency with named, shared, editable lists and large enqueue support.

### Scope

- Introduce named Workbench lists.
- Default sharing model: private-by-default with explicit owner opt-in (`is_shared`) for collaborator visibility.
- Allow collaborators on shared lists to add/drop/reorder cards while owner-only settings guard share/rename/delete.
- Add “send selected / matching / set cards to Workbench list” flow with 5,000 cap warning.

### Primary file touches

- `supabase/migrations/` (new migration(s); next available number)
  - New tables/RLS for shared workbench lists and list items.
- `src/data/supabase/appAdapter.js`
  - New list CRUD + list item operations.
- `src/pages/WorkbenchPage.jsx`
  - List switcher, create/rename/delete, shared editing behaviors.
- `src/pages/ExplorePage.jsx`
  - Batch enqueue actions targeting selected list.
- `src/components/BatchWizard.jsx`
  - Reuse matching-card selection/enqueue UX where applicable.

### QA pause gate (manual)

- Create multiple lists, rename/delete one, reorder cards, and remove cards.
- Verify private lists are hidden from other users until owner marks them shared.
- Verify collaborator can edit/add/drop cards on same shared list.
- Verify collaborator cannot rename/delete/toggle sharing on a list they do not own.
- Try enqueue over 5,000 matching cards and verify warning/guard UX.

### Implementation snapshot (current branch state)

- Shared list CRUD + list switcher are live in Workbench (`create`, `rename`, `delete`, reorder, remove selected/matching, move selected).
- Explore enqueue now supports **selected**, **matching**, and **set-based** sends to Workbench lists.
- Enqueue warnings now have 5,000-cap parity (`full list`, `partial add`, and `already present` cases).
- Set enqueue now uses a large-set confirm gate (100+ cards) and prevents duplicate dialog spam during pre-check.
- Card detail + Workbench copy now consistently uses **list** wording (replacing mixed queue/list phrasing).
- Sharing model now supports **explicit visibility** (`is_shared`) so lists are private by default; cross-user visibility requires owner opt-in.
- Ownership UX is surfaced in selectors (`My lists` / `Shared with me`) and owner-only list settings are guarded in UI + DB (rename/delete/share controls).
- Shared-target context hints now appear in Explore, Batch, and Card Detail enqueue entry points when the active target is teammate-owned.
- Move-selected now uses an **atomic DB RPC** with 5,000-cap enforcement, so partial failures no longer create split-brain source/target list states.
- Bulk-remove Undo now performs **additive restore** of removed IDs (instead of full snapshot overwrite), reducing shared-list teammate edit clobber risk.

---

## Phase 7 — Workbench pins editor parity (feature)

**Goal:** users can edit and rearrange pins inside Workbench, mirroring card detail behavior.

### Scope

- Add pin editor entry point in Workbench.
- Persist Workbench pin order/settings (prefer separate key from card detail pins).
- Render Workbench editor using pin order preferences.

### Primary file touches

- `supabase/migrations/` (optional; only if new preference column is needed)
- `src/lib/cardDetailPinRegistry.js`
  - Add/extend keys used by Workbench pin controls.
- `src/pages/WorkbenchPage.jsx`
  - Pin editor launch + application of pin ordering.
- `src/components/CardDetailPinEditor.jsx`
  - Reuse for Workbench mode with scoped preference key.
- `src/data/supabase/appAdapter.js`
  - Preference read/write updates for Workbench pins.

### QA pause gate (manual)

- Edit pin order in Workbench and confirm layout updates immediately.
- Reload and verify persistence.
- Confirm card detail pin behavior is unchanged.

---

## Phase 8 — One-box search normalization (feature/quality)

**Goal:** align results for variants like `Mewtwo EX` and `Mewtwo-EX` while keeping one search input.

### Scope

- Add normalized query behavior for punctuation/case/spacing variants.
- Keep relevance controlled; avoid overly broad false positives.
- Maintain Explore performance expectations.

### Primary file touches

- `supabase/migrations/` (optional, recommended)
  - Add normalized search expression/index support if needed.
- `src/data/supabase/appAdapter.js`
  - Search query normalization and/or expanded matching strategy.
- `src/pages/ExplorePage.jsx`
  - Keep URL/query behavior stable with normalized search.

### QA pause gate (manual)

- Compare query pairs (`Mewtwo EX` vs `Mewtwo-EX`, etc.) and verify parity.
- Check common unrelated queries to ensure no major precision regressions.
- Spot-check query latency against current behavior.

---

## Suggested execution order

1. Phase 1 (Data Health deep-link parity)
2. Phase 2 (Artist/Illustrator filter parity)
3. Phase 3 (Background details cleanup)
4. Phase 4 (Jumbo Card + Explore filter)
5. Phase 5 (Manual rename + history tracking)
6. Phase 6 (Shared Workbench lists + 5,000 enqueue cap)
7. Phase 7 (Workbench pins parity)
8. Phase 8 (Search normalization)

---

## Implementation notes

- Keep each phase in a separate PR or clearly separated commit group to preserve rollback flexibility.
- Migrations should be additive and forward-only; avoid backfilling with destructive rewrites.
- For shared list RLS in Phase 6, choose the simplest permissive collaborator model first, then tighten roles later if needed.
- Reuse existing batch selection limits and warning copy for enqueue cap consistency.
