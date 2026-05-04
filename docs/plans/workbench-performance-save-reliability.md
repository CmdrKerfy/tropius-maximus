# Plan: Workbench — performance, save reliability, and navigation

**Status:** All phases complete (0–6). Camera angle multi-select migration + all app changes implemented. Ready for commit.

**Branch:** `v2/supabase-migration`

**Related:** The uncommitted changes in the working tree are pre-work for this plan. See "Phase 0" below.

---

## Scope summary

| Tier | Theme | Effort |
|------|-------|--------|
| **Phase 0** | Commit existing uncommitted fixes | ~5 min (verify + commit) |
| **Phase 1** | Eliminate queue refetch on navigation | ~30 min (direct cache writes) |
| **Phase 2** | Pre-fetch adjacent cards | ~30 min (background prefetch) |
| **Phase 3** | Fix no-op overwrite bug in save path | ~20 min (return value change) |
| **Phase 4** | Serialize per-card saves (kill self-races) | ~45 min (promise queue) |
| **Phase 5** | Verify + polish | ~15 min (check:quick + manual smoke) |
| **Phase 6** | Camera angle multi-select | ~90 min (migration + 7 files) |

**Total estimated:** ~4 hours

---

## Phase 0 — Commit existing uncommitted changes

The working tree has ~91 lines of uncommitted changes across 3 files. These are solid incremental fixes that should be committed before starting new work.

### What's in the diff

**`src/data/supabase/appAdapter.js`:**
- `mergeSortedUniqueStrings` now deduplicates case-insensitively (Map keyed by lowercase). Fixes "Aerial" / "aerial" both appearing in camera_angle and other ComboBox options.

**`src/components/AnnotationEditor.jsx`:**
- `mergedSuggestionOptions` now deduplicates case-insensitively (same Map pattern), matching the adapter fix above.
- New `syncReactQueryCardCaches(queryClient, cardId, flatAnnotations)` helper: after a save, writes the returned annotations into `["workbenchCard", cardId]` and any `["cardDetail", cardId, ...]` query caches. Prevents background refetches from resurrecting stale annotations.
- New `scheduleFormOptionsInvalidate`: debounces `invalidateQueries(FORM_OPTIONS_QUERY_KEY)` by 2.8s so rapid saves coalesce into one heavy `get_form_options_db` RPC refresh.
- `persistField` and `undoLast` call `syncReactQueryCardCaches` after successful saves.
- `serverSnapshotRef` reset now only depends on `cardId` change (not `annotations` reference), so background refetches don't reset the undo stack.

**`src/pages/WorkbenchPage.jsx`:**
- New `goFirst` / `goLast` functions: set `current_index` to 0 / `cardIds.length - 1`.
- First / Last buttons in the queue header UI (ChevronsLeft / ChevronsRight icons, "First" / "Last" labels hidden on small screens).
- `workbenchCard` query now uses `staleTime: 120_000` and `refetchOnWindowFocus: false`.

### Actions

1. Run `npm run check:quick` to confirm the diff passes.
2. `git add` the three files.
3. Commit with message describing all four user-facing fixes.
4. Do NOT push unless the user asks.

### Verification

- `npm run check:quick` passes (build + unit tests).
- Manual: open Workbench, verify First/Last buttons appear, verify camera_angle ComboBox doesn't show "Aerial" and "aerial" as separate options.

---

## Phase 1 — Direct cache writes for navigation (eliminate queue refetch)

### Problem

Every prev/next/first/last calls `patchQueue.mutate({ queueId, patch: { current_index } })`. The `onSuccess` callback does `invalidateQueries({ queryKey: ["workbenchQueues"] })`. This triggers a **full refetch of all queues** from Supabase just to record that the user moved from index 5 to index 6. On a slow connection or with many queues, this is a visible round-trip on every keystroke.

### Fix

Replace the invalidate-Queries pattern with a direct `setQueryData` cache write for `current_index` changes:

```js
// New: optimistic-only navigation that skips the server round-trip
const navigateTo = useCallback((newIndex) => {
  if (!queue?.id) return;
  const clamped = Math.max(0, Math.min(newIndex, cardIds.length - 1));

  // Write directly into the cache so the UI updates instantly
  queryClient.setQueryData(["workbenchQueues"], (old) => {
    if (!Array.isArray(old)) return old;
    return old.map((q) =>
      String(q.id) === String(queue.id) ? { ...q, current_index: clamped } : q
    );
  });

  // Persist to server in the background (debounced per-queue)
  debouncedSyncQueueIndex(queue.id, clamped);
}, [queue?.id, cardIds.length, queryClient]);
```

The `debouncedSyncQueueIndex` function:
- Uses a per-queue timer (stored in a ref map) at ~1.5s.
- On fire, calls `updateWorkbenchQueue(queueId, { current_index })` to persist the latest position.
- Errors are silent (the cache is already correct; next full refetch will reconcile).
- On unmount or queue switch, flush immediately.

The existing `patchQueue` mutation stays for operations that actually change queue structure (remove card, bulk remove, reorder) — those still need full invalidation.

### Files touched

- `src/pages/WorkbenchPage.jsx`: add `debouncedSyncQueueIndex` util, replace `patchQueue.mutate` calls in `goPrev`/`goNext`/`goFirst`/`goLast` with `navigateTo`.

### Verification

- Open Workbench with a queue of 5+ cards. Click Next rapidly. The position counter should update instantly with no network spinner.
- Refresh the page. The last persisted `current_index` should be restored (within ~1.5s of the last navigation).
- Switch queues, verify the old queue's index was flushed.

---

## Phase 2 — Pre-fetch adjacent cards

### Problem

Even with Phase 1's instant navigation, the card content still shows a loading spinner because `["workbenchCard", currentCardId]` has no data for the new card. The user waits for `fetchCard` → server → response before they can edit.

### Fix

When `currentCardId` settles, pre-fetch the next and previous cards into the query cache:

```js
useEffect(() => {
  if (!currentCardId || cardIds.length <= 1) return;
  const nextId = cardIds[safeIndex + 1];
  const prevId = cardIds[safeIndex - 1];
  const toPrefetch = [nextId, prevId].filter(Boolean);
  for (const id of toPrefetch) {
    queryClient.prefetchQuery({
      queryKey: ["workbenchCard", id],
      queryFn: () => fetchCard(id, "TCG"),
      staleTime: 120_000,
    });
  }
}, [currentCardId, cardIds, safeIndex, queryClient]);
```

TanStack Query's `prefetchQuery` is a no-op if the data is already in cache and fresh. The existing `staleTime: 120_000` means pre-fetched data stays warm for 2 minutes.

### Files touched

- `src/pages/WorkbenchPage.jsx`: add the `useEffect` after the card query definition.

### Verification

- Open Workbench with a queue of 5+ cards. Wait for the first card to load (~1s). Click Next. The next card should appear instantly (no spinner).
- Click Previous. Should also be instant.
- Navigate 3+ cards away, then back. The original card should still be warm.

---

## Phase 3 — Fix no-op overwrite bug in `patchAnnotations`

### Problem

When `patchAnnotations` determines that the patch would produce no changes (line 2143 of `appAdapter.js`):

```js
if (historyPayload.length === 0) {
  return prevFlat;  // ← returns OLD server state, not the caller's patch
}
```

Back in `AnnotationEditor.persistField`:

```js
const result = await patchAnnotations(cardId, { [key]: value });
setValues(result);  // ← overwrites local edits with stale server state
```

The user typed a new value, blurred, saw "Saving...", then "Saved" — but their edit was replaced by the old server value. Visually indistinguishable from "didn't save."

This triggers when:
- The user edits a field, then edits it back to the original value before blur.
- The normalized form of the value matches the server (e.g., trailing whitespace stripped).
- A race condition causes the patch to match the current server state.

### Fix

Change `patchAnnotations` to return a result object that distinguishes "saved" from "no-op":

```js
// Before (line 2143):
if (historyPayload.length === 0) {
  return prevFlat;
}

// After:
if (historyPayload.length === 0) {
  return { annotations: prevFlat, saved: false };
}
```

And the success return (line 2173):

```js
// Before:
return fetchAnnotations(cardId);

// After:
const fresh = await fetchAnnotations(cardId);
return { annotations: fresh, saved: true };
```

Then update `persistField`:

```js
const { annotations, saved } = await patchAnnotations(cardId, { [key]: value });
if (saved) {
  setValues(annotations);
  serverSnapshotRef.current = { ...annotations };
  // ... undo stack, sync caches, etc.
  onSaveStatusChange?.({ phase: "saved", ... });
} else {
  // No-op: don't touch local state. Just update status silently.
  onSaveStatusChange?.({ phase: "idle", ... });
}
```

### Files touched

- `src/data/supabase/appAdapter.js`: change return type of `patchAnnotations`.
- `src/components/AnnotationEditor.jsx`: destructure `saved`, guard `setValues` on it.
- `src/components/CardDetail.jsx`: update `withSupabaseAnnotationSave` to handle new return shape.
- Any batch-edit path that calls `patchAnnotations` directly (check `BatchWizard.jsx`).

### Verification

- In Workbench, edit a field, then edit it back to its original value and blur. The save status should briefly show "saving" then return to "idle" (not "saved"). The field value should not change.
- Normal save → edit → blur should still work and show "Saved."

---

## Phase 4 — Per-card save serialization

### Problem

When a user edits two fields in quick succession (e.g., tabs from ComboBox A to textarea B, both trigger save on blur/change):

1. Save A reads version 5, calls RPC.
2. Save B reads version 5 (before A's RPC completes), calls RPC.
3. A's RPC succeeds → version 6.
4. B's RPC fails with version conflict → retry loop re-reads (version 6), re-merges, retries RPC.
5. B usually succeeds on retry 1.

This works most of the time. But if the user is fast and triggers 3+ saves before any RPC completes, the retry budget (6 attempts) can exhaust. The last save drops. Error handler rolls back the field in the UI, but the user may have already moved on.

### Fix

Add a per-card promise queue so only one `patchAnnotations` call executes at a time per cardId:

```js
// In appAdapter.js
const saveQueues = new Map();

export async function patchAnnotations(cardId, patch, options = {}) {
  const key = String(cardId);
  // Get or create a queue for this card
  if (!saveQueues.has(key)) {
    saveQueues.set(key, Promise.resolve());
  }
  // Chain onto the queue
  const prev = saveQueues.get(key);
  const task = prev.then(() => patchAnnotationsImpl(cardId, patch, options));
  // Store the new tail (catch so a rejection doesn't break the chain)
  saveQueues.set(key, task.catch(() => {}));
  return task;
}

// Existing implementation renamed to patchAnnotationsImpl
async function patchAnnotationsImpl(cardId, patch, options) {
  // ... exact same code as current patchAnnotations ...
}
```

This guarantees:
- Saves for the same card execute in order.
- Each save reads the latest version (written by the previous save in the queue).
- No version conflicts from self-racing. The retry loop becomes purely a defense against cross-user conflicts.
- Different cards are not serialized (independent queues).

Cleanup: each queue entry cleans itself up after settling:

```js
// After chaining the task, schedule cleanup
const cleanupTarget = task;
task.finally(() => {
  setTimeout(() => {
    // Only delete if this promise is still the tail (no newer saves queued)
    if (saveQueues.get(key) === cleanupTarget) {
      saveQueues.delete(key);
    }
  }, 5000);
});
```

The 5s settle delay keeps the queue alive during bursts of rapid edits on the same card, then releases it once the user moves on. For the expected workload (~3 users, modest editing volume), this keeps the Map small.

### Files touched

- `src/data/supabase/appAdapter.js`: wrap `patchAnnotations` with the queue, rename implementation to `patchAnnotationsImpl`.

### Verification

- In Workbench, rapidly edit 5 different fields on the same card (ComboBox → click option, tab to next, repeat). All 5 saves should succeed. The card's version should be incremented by exactly 5.
- `npm run check:quick` passes.

---

## Phase 5 — Verify + polish

### Actions

1. `npm run check:quick` — must pass.
2. Manual smoke in Workbench (Supabase mode):
   - Create a queue with 10+ cards.
   - Navigate First → Last → Previous → Next rapidly. Confirm instant transitions, no spinners.
   - Edit camera_angle, artist, and a multi-select field. All should save and persist after page refresh.
   - Undo (Cmd+Shift+Z) should still work.
   - Manage list → move cards between queues should still work.
   - Remove from list should still work.
3. Check that Explore → Workbench send flow still works.

### Rollback plan

If something breaks:
- Phase 1 + 2 are additive (new functions, new useEffect). Roll back by reverting WorkbenchPage.jsx.
- Phase 3 changes the return type of `patchAnnotations`. All callers must be updated together. If partial, saves will break. Revert all files in the phase.
- Phase 4 wraps `patchAnnotations` in a queue. If it deadlocks, revert by removing the wrapper and restoring the direct export.

---

## Phase 6 — Camera angle: TEXT → JSONB[] with multi_select

**Decision:** User confirmed camera_angle should support multiple values per card (2026-05-02).

### Current state

- DB column: `camera_angle TEXT` (single string, nullable)
- `field_definitions`: `field_type = 'select'` (single-value ComboBox)
- Static options: 16 canonical values in `CAMERA_ANGLE_OPTIONS`
- Values stored as plain strings, e.g. `"Aerial"` or `"Aerial, Profile"` (packed)

### Target state

- DB column: `camera_angle JSONB DEFAULT '[]'` (array of strings, matching `art_style`, `pose`, `emotion`, etc.)
- `field_definitions`: `field_type = 'multi_select'`
- UI: `MultiComboBox` in Workbench, CardDetail, CardDetailFieldControl, and CustomCardForm
- All existing single values backfilled to single-element arrays
- Packed strings (e.g. `"Aerial, Profile"`) split into arrays during backfill

### 6.1 — Migration `044_camera_angle_multi_select.sql`

**Note on expand-contract:** A safer pattern for production would split this into two migrations — (A) add `camera_angle_new`, backfill, deploy app code that writes to the new column with fallback reads; (B) later, drop the old column and rename. For this app (3 users, single deploy target, negligible traffic), the risk of needing a mid-migration rollback is near zero. The single-migration approach is simpler and acceptable here.

```sql
-- 044_camera_angle_multi_select.sql

-- 1. Add new JSONB array column
ALTER TABLE annotations ADD COLUMN camera_angle_new JSONB DEFAULT '[]';

-- 2. Backfill: split packed TEXT values into array elements
UPDATE annotations
SET camera_angle_new = subq.arr
FROM (
  SELECT a.card_id,
    COALESCE(
      (SELECT jsonb_agg(trimmed ORDER BY idx)
       FROM (
         SELECT DISTINCT ON (lower(elem)) trim(elem) AS trimmed, min(idx) AS idx
         FROM unnest(
           string_to_array(
             regexp_replace(regexp_replace(a2.camera_angle, '\s*[,;，；]\s*', '|', 'g'), '\|+', '|', 'g'),
             '|'
           )
         ) WITH ORDINALITY AS t(elem, idx)
         WHERE trim(elem) <> ''
       ) deduped
      ),
      '[]'::jsonb
    ) AS arr
  FROM annotations a2
  WHERE a2.camera_angle IS NOT NULL AND btrim(a2.camera_angle) <> ''
) subq
WHERE annotations.card_id = subq.card_id;

-- 3. Drop old TEXT column
ALTER TABLE annotations DROP COLUMN camera_angle;

-- 4. Rename new column
ALTER TABLE annotations RENAME COLUMN camera_angle_new TO camera_angle;

-- 5. Update get_form_options_db RPC: change camera_angle from scalar DISTINCT to unnest pattern
CREATE OR REPLACE FUNCTION public.get_form_options_db()
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  -- ... (full function body reproduced; only the camera_angle section changes) ...
  -- OLD (scalar):
  --   'camera_angle',
  --   COALESCE(
  --     (SELECT jsonb_agg(x ORDER BY x)
  --      FROM (
  --        SELECT DISTINCT camera_angle AS x
  --        FROM ann
  --        WHERE camera_angle IS NOT NULL AND btrim(camera_angle) <> ''
  --      ) d),
  --     '[]'::jsonb
  --   ),
  --
  -- NEW (array/unnest):
  --   'camera_angle',
  --   COALESCE(
  --     (SELECT jsonb_agg(x ORDER BY x)
  --      FROM (
  --        SELECT DISTINCT elem AS x
  --        FROM ann,
  --        LATERAL jsonb_array_elements_text(ann.camera_angle) AS elem
  --        WHERE elem IS NOT NULL AND btrim(elem) <> ''
  --      ) d),
  --     '[]'::jsonb
  --   ),
$$;

-- 6. Change field_definitions to multi_select
UPDATE field_definitions
SET field_type = 'multi_select'
WHERE name = 'camera_angle';

-- 7. Grant EXECUTE on updated RPC
GRANT EXECUTE ON FUNCTION public.get_form_options_db() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_form_options_db() TO service_role;
```

**Important:** The `get_form_options_db` RPC body must be reproduced in full (currently ~180 lines in `021_form_options_rpc.sql`). Only the `camera_angle` subquery changes (scalar DISTINCT → unnest). Do NOT edit `021_form_options_rpc.sql` (that would break migration checksums); reproduce the function with `CREATE OR REPLACE` in the new migration.

### 6.2 — appAdapter.js: move camera_angle from text scalars to JSONB arrays

**Remove from `ANNOTATION_TEXT_SCALAR_KEYS`** (line 508):
```js
// Delete: "camera_angle",
```

**Remove from `ANN_TEXT_TO_FORM`** (line 249):
```js
// Delete: camera_angle: "cameraAngle",
```

**Add to `ANNOTATION_JSONB_COLUMNS`** (after line 494):
```js
"camera_angle",
```

**Add to `ANN_JSONB_ARRAY_TO_FORM`** (after line 244):
```js
camera_angle: "cameraAngle",
```

**Add to `ANNOTATION_ROW_INSERT_DEFAULTS`** in `annotationBridge.js` (after `multi_card: []`):
```js
camera_angle: [],
```

### 6.3 — CardDetail.jsx: multi-value handling

**1. Add to `MULTI_VALUE_ANNOTATION_KEYS`** (after line 78, or anywhere in the Set):
```js
"camera_angle",
```
This set controls: when a string is received, split it into an array. With the migration, the column will already be an array from PostgREST, but this guards against legacy packed strings during transition.

**2. Change ComboBox to MultiComboBox** (line 2103):
```jsx
// Before:
<ComboBox value={annValue("camera_angle")} onChange={(v) => saveAnnotation("camera_angle", v)} options={optArr(opts.cameraAngle)} placeholder="Aerial, Upside Down, etc." className={inputClass + " w-full"} />

// After:
<MultiComboBox value={annValue("camera_angle") || []} onChange={(v) => saveAnnotation("camera_angle", v)} options={optArr(opts.cameraAngle)} placeholder="Aerial, Upside Down, etc." className={inputClass + " w-full"} />
```

### 6.4 — CardDetailFieldControl.jsx: MultiComboBox

Lines 500–511, change `ComboBox` to `MultiComboBox`:
```jsx
// Before:
<ComboBox
  value={annValue("camera_angle")}
  onChange={(v) => saveAnnotation("camera_angle", v)}
  options={optArr(opts.cameraAngle)}
  placeholder="Aerial, Upside Down, etc."
  className={inputClass + " w-full"}
/>

// After:
<MultiComboBox
  value={annValue("camera_angle") || []}
  onChange={(v) => saveAnnotation("camera_angle", v)}
  options={optArr(opts.cameraAngle)}
  placeholder="Aerial, Upside Down, etc."
  className={inputClass + " w-full"}
/>
```

Make sure `MultiComboBox` is imported at the top of the file.

### 6.5 — CustomCardForm.jsx: MultiComboBox + array state

**State** (line 179):
```js
// Before:
const [cameraAngle, setCameraAngle] = useState("");

// After:
const [cameraAngle, setCameraAngle] = useState([]);
```

**Payload** (line 379):
```js
// Before:
camera_angle: cameraAngle || "",

// After:
camera_angle: cameraAngle,
```

**UI** (line 1194):
```jsx
// Before:
<ComboBox value={cameraAngle} onChange={setCameraAngle} options={opts.cameraAngle || []} placeholder="Aerial, Upside Down, etc." className={inputClass + " w-full"} />

// After:
<MultiComboBox value={cameraAngle} onChange={setCameraAngle} options={opts.cameraAngle || []} placeholder="Aerial, Upside Down, etc." className={inputClass + " w-full"} />
```

### 6.6 — seed.sql: align for fresh installs

In `supabase/seed.sql`, find the `camera_angle` field_definition INSERT and change:
```sql
-- Before:
('camera_angle', 'Camera Angle', 'select', 'visual', 50, '[...]')

-- After:
('camera_angle', 'Camera Angle', 'multi_select', 'visual', 50, '[...]')
```

The curated_options JSON array stays unchanged.

### 6.7 — DuckDB (db.duckdb.js): optional, low priority

DuckDB is the legacy v1 backend. Workbench is Supabase-only. The DuckDB schema has `camera_angle VARCHAR` at line 428 — this could be updated but v1 edits are frozen. Skip for now; if DuckDB annotations are ever reactivated, handle then.

### Files touched (Phase 6)

| File | What changes |
|------|-------------|
| `supabase/migrations/044_camera_angle_multi_select.sql` | **New.** Column migration + RPC update + field_definitions update |
| `src/data/supabase/appAdapter.js` | Move camera_angle between constant sets (4 edits) |
| `src/data/supabase/annotationBridge.js` | Add `camera_angle: []` to `ANNOTATION_ROW_INSERT_DEFAULTS` |
| `src/components/CardDetail.jsx` | Add to `MULTI_VALUE_ANNOTATION_KEYS`; ComboBox → MultiComboBox |
| `src/components/CardDetailFieldControl.jsx` | ComboBox → MultiComboBox; import MultiComboBox |
| `src/components/CustomCardForm.jsx` | `useState([])`, payload fix, ComboBox → MultiComboBox |
| `supabase/seed.sql` | `field_type` → `multi_select` |

### Verification (Phase 6)

1. Apply migration `044` to Supabase. Verify `camera_angle` is `JSONB DEFAULT '[]'` in `annotations`.
2. Spot-check backfill: find a card that had `camera_angle = 'Aerial'`, confirm it's now `["Aerial"]`.
3. Find or create a card with packed value `"Aerial, Profile"`, confirm it's now `["Aerial", "Profile"]`.
4. `npm run check:quick` passes.
5. Manual smoke:
   - Workbench: open a card, camera_angle should render as MultiComboBox. Select "Aerial" and "Profile". Save. Refresh — both should persist.
   - CardDetail (Explore): same card, camera_angle should show as chips in read-only, MultiComboBox in edit mode.
   - CustomCardForm: create a new card with multiple camera angles. Save. Verify persistence.
   - Form options: after saving new camera_angle values, verify the ComboBox suggestions update (may take up to 2.8s debounce + 5min staleTime).

### Rollback (Phase 6)

If migration `044` has been applied to production and needs reverting:
1. The column type change is lossy (TEXT → JSONB[]). Restore from a pre-migration backup or re-run the migration in reverse: add TEXT column, backfill from JSONB[] with `array_to_string`, drop JSONB[] column, rename TEXT column, re-create the old RPC.
2. App code changes (6.2–6.6) must be reverted together with the migration. If app code expects JSONB[] but the column is still TEXT, saves will fail.

---


## Files summary

| File | Phase 0 | Phase 1 | Phase 2 | Phase 3 | Phase 4 | Phase 6 |
|------|---------|---------|---------|---------|---------|---------|
| `src/pages/WorkbenchPage.jsx` | commit (First/Last + staleTime) | rewrite navigation | add prefetch useEffect | — | — | — |
| `src/components/AnnotationEditor.jsx` | commit (dedup + cache sync + debounce) | — | — | handle `{annotations, saved}` | — | — |
| `src/data/supabase/appAdapter.js` | commit (dedup) | — | — | return `{annotations, saved}` | add per-card save queue | move camera_angle between constant sets |
| `src/data/supabase/annotationBridge.js` | — | — | — | — | — | add `camera_angle: []` to defaults |
| `src/components/CardDetail.jsx` | — | — | — | handle new return shape | — | MULTI_VALUE_KEYS + MultiComboBox |
| `src/components/CardDetailFieldControl.jsx` | — | — | — | — | — | ComboBox → MultiComboBox |
| `src/components/CustomCardForm.jsx` | — | — | — | — | — | array state + MultiComboBox |
| `src/components/BatchWizard.jsx` | — | — | — | handle new return shape (if it calls patchAnnotations) | — | — |
| `supabase/migrations/044_*.sql` | — | — | — | — | — | **New.** column migration + RPC update |
| `supabase/seed.sql` | — | — | — | — | — | field_type → multi_select |

## Handoff state (for next agent)

After Phase 0 is committed:
- All four original user-facing issues have at least partial fixes deployed.
- Navigation still has the full-queue-refetch bottleneck (Phase 1).
- Save reliability still has the no-op overwrite and self-racing bugs (Phases 3–4).
- Camera angle multi-select migration + app changes ready to implement (Phase 6).

The next agent should proceed with Phase 1, verify, then Phase 2, verify, etc. Each phase is independently shippable. Phase 6 (camera angle) is independent of Phases 1–4 and can be done in any order.
