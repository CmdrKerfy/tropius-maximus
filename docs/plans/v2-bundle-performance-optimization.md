# Plan: V2 Bundle Performance Optimization

## Context

The v2/Supabase production build produces a single 993KB JS chunk (268KB gzipped) that includes every page, DuckDB WASM (34MB + 39MB), and all data adapters — even though v2 users on Vercel never touch DuckDB. The build warns "Some chunks are larger than 500 kB."

Additionally, the ExplorePage forces `count: exact` on every Supabase query, causing Postgres full-count scans on every page change, search/filter-driven refetch, and prefetch.

Branch: `v2/supabase-migration`. All changes are frontend-only (Vite + React).

---

## Findings (Fact-Checked)

### 1. No Route-Level Code Splitting

**App.jsx lines 7–18:** 11 static `import` statements for every page component. `React.lazy()` is never used. A user visiting `/login` downloads ExplorePage (1,963 lines), WorkbenchPage (1,426 lines), CardDetail (2,514 lines), BatchEditPage, DataHealthPage, etc.

### 2. DuckDB WASM Statically Imported

**db.js line 6:** `import * as duck from "./db.duckdb.js"` — top-level static import. The bundler pulls in `@duckdb/duckdb-wasm` and its 34MB + 39MB WASM assets (7.7MB + 8.8MB gzipped) regardless of `USE_SUPABASE_APP`. v2/Supabase users download WASM they'll never execute.

### 3. Exact Count on Every Explore Query

**ExplorePage.jsx line 312:** `const EXPLORE_EXACT_COUNT = USE_SUPABASE_APP;`
**Line 328:** `...(USE_SUPABASE_APP ? { exact_count: EXPLORE_EXACT_COUNT } : {}),`

`count: exact` forces Postgres to count all matching rows on every query — the main grid, page N−1 prefetch, and page N+1 prefetch. The app's own documentation (appAdapter.js line 774) says planned is the "faster" default. Exact is only needed for batch-confirm and fetchFirstNMatchingCardIds.

### 4. CardItem Not Memoized

**CardGrid.jsx line 20:** `function CardItem(...)` — no `React.memo`. Every search/filter refetch or batch-selection update causes all 120 CardItem instances to re-render.

### 5. Vite vendor-react Chunk is 0 Bytes

Build output shows `vendor-react-l0sNRNKZ.js: 0.00 kB`. The `manualChunks` config in vite.config.js is syntactically valid (`"vendor-react": ["react", "react-dom"]`), but React is being hoisted/inlined into the main chunk rather than split out.

### 6. Client-Paged Fallback Scans Entire Tables

**appAdapter.js line 311–335:** `mergeAnnotationUsageIntoOptions` pages through all annotations (pageSize=1000, unlimited). **Lines 444–465:** `distinctColumn` pages through all cards (pageSize=1000, unlimited). With 15,000+ rows each, these are 15+ round-trips per call. The RPC path avoids this, but the fallback remains reachable.

---

## Implementation

### P0 — 1 hour 40 minutes total

#### P0.1: Exact count → planned + missing import fix (10 minutes)

**File:** `src/pages/ExplorePage.jsx`

Change line 312 from `const EXPLORE_EXACT_COUNT = USE_SUPABASE_APP;` to `false`.

```js
// Before:
const EXPLORE_EXACT_COUNT = USE_SUPABASE_APP;
// After:
const EXPLORE_EXACT_COUNT = false;
```

The page-clamp `useEffect` (lines 378-384) reads `cardsResult.total` from PostgREST's `Content-Range` header — this works with both planned and exact counts. Planned counts are accurate enough for page clamping; the worst case (user landing on a non-existent page) is already handled by the clamp effect. "Page N of M" may drift slightly with stale estimates, but this is imperceptible in practice. If clamp bugs appear after bulk ingest (planned totals drift severely), run `ANALYZE` on the cards table or temporarily re-enable exact for clamp-only.

**Also fix a pre-existing bug:** `fetchCard` (singular) is called at lines 451 and 460 in the card-detail prefetch effect but is not imported. Add `fetchCard` to the import from `"../db"` at line 10:

```js
import {
  fetchCards,
  fetchCard,  // ← add this
  fetchExploreFilterOptions,
  // ...
} from "../db";
```

Without this, the card-detail prefetch silently fails (`prefetchQuery` catches errors).

**Optional cleanup while touching this file:** `keepPreviousData` is deprecated in TanStack Query v5. Replace:
```js
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
// →
import { useQuery, useQueryClient } from "@tanstack/react-query";

// And in useQuery options:
placeholderData: keepPreviousData,
// →
placeholderData: (prev) => prev,
```

#### P0.2: DuckDB dynamic import (45 minutes)

**File:** `src/db.js`

Replace the static import with a dynamic, lazily-initialized module:

```js
// Before (line 6):
import * as duck from "./db.duckdb.js";

// After:
let _duck = null;
async function _getDuck() {
  if (!_duck) _duck = await import("./db.duckdb.js");
  return _duck;
}
```

Then update every call site from `duck.foo()` to `(await _getDuck()).foo()`. `db.js` has dozens of `duck.*` branches — the change is mechanical but needs care:
- `duck.initDB()` → `(await _getDuck()).initDB()`
- `duck.initDB()` → `(await _getDuck()).initDB()`
- `duck.fetchCards()` → `(await _getDuck()).fetchCards()`
- And every other `duck.` reference in the file

The `initDB()` function (which calls `duck.init()`) is the primary entry point and already async — but every internal branch that references `duck` must be updated too. Additionally, `getCustomSourceNames()` (line 27) is a synchronous export that calls `duck.getCustomSourceNames()`. Make it async:

```js
// Before:
export function getCustomSourceNames() {
  if (useSupabaseBackend()) return [...SOURCE_OPTIONS];
  return duck.getCustomSourceNames();
}

// After:
export async function getCustomSourceNames() {
  if (useSupabaseBackend()) return [...SOURCE_OPTIONS];
  return (await _getDuck()).getCustomSourceNames();
}
```

It has no external callers, so making it async is safe.

**Verify:** Run `npm run check:quick` after the change. After build, the DuckDB WASM files should NOT appear in the network tab on a fresh Vercel/Supabase page load. **Also verify v1/DuckDB mode still works:** `initDB()` → `duck.initDB()` must load WASM correctly in the browser (GitHub Pages path).

#### P0.3: React.lazy routes (45 minutes)

**File:** `src/App.jsx`

Replace 11 static imports with `lazy()` + `Suspense`:

```js
// Before:
import ExplorePage from "./pages/ExplorePage.jsx";
import WorkbenchPage from "./pages/WorkbenchPage.jsx";
// ... 9 more

// After:
import { lazy, Suspense } from "react";

const ExplorePage = lazy(() => import("./pages/ExplorePage.jsx"));
const WorkbenchPage = lazy(() => import("./pages/WorkbenchPage.jsx"));
const DataHealthPage = lazy(() => import("./pages/DataHealthPage.jsx"));
const FieldsPage = lazy(() => import("./pages/FieldsPage.jsx"));
const BatchEditPage = lazy(() => import("./pages/BatchEditPage.jsx"));
const EditHistoryPage = lazy(() => import("./pages/EditHistoryPage.jsx"));
const DashboardPage = lazy(() => import("./pages/DashboardPage.jsx"));
const ProfilePage = lazy(() => import("./pages/ProfilePage.jsx"));
const PublicShareCardPage = lazy(() => import("./pages/PublicShareCardPage.jsx"));

// Auth pages can stay eager (they're tiny and needed at startup):
import LoginPage from "./pages/LoginPage.jsx";
import AuthCallbackPage from "./pages/AuthCallbackPage.jsx";
import AuthResetPasswordPage from "./pages/AuthResetPasswordPage.jsx";
```

Wrap routes in a Suspense boundary:

```jsx
<Suspense fallback={<div className="p-8 text-center text-gray-500">Loading…</div>}>
  <Routes>
    {/* all routes */}
  </Routes>
</Suspense>
```

**Verify:** After build, each page should appear as a separate chunk (e.g. `WorkbenchPage-*.js`, `BatchEditPage-*.js`). First-load JS should drop from ~993KB to ~400-500KB.

---

### P1 — 20 minutes

#### P1.1: React.memo(CardItem)

**File:** `src/components/CardGrid.jsx`

Wrap CardItem:

```js
// Before:
function CardItem({ card, isSelected, onCardClick, onToggleSelection }) {
  // ...
}

// After:
const CardItem = memo(function CardItem({ card, isSelected, onCardClick, onToggleSelection }) {
  // ...
});
```

Ensure `memo` is added to the React import at the top of CardGrid.jsx (currently only imports `useState`):

```js
import { useState, memo } from "react";
```

`onCardClick` from ExplorePage (`setSelectedCardId`) is a setState dispatch — stable by React guarantee. `onToggleSelection` from `useBatchSelection` is recreated when `ids` changes (every select/deselect), so selecting any checkbox still forces new props on every memoized CardItem. Memo still helps when the parent re-renders for unrelated state (modals, queues, toast timers) while cards + selection are unchanged — just don't expect it to fix "select one checkbox" cost.

---

### P2 — 25 minutes

#### P2.1: decoding="async" on grid images

**File:** `src/components/CardGrid.jsx` — add `decoding="async"` to `<img>` tags. One attribute, no logic change. Reduces main-thread decode contention during scroll.

#### P2.2: Cap fallback scans

**File:** `src/data/supabase/appAdapter.js`

In `mergeAnnotationUsageIntoOptions` (~line 311), `distinctColumn` (~line 444), and `distinctAnnotationColumn` (~line 468), add a hard cap:

```js
const MAX_FALLBACK_SCAN_ROWS = 5000;
// Inside the loop:
if (from >= MAX_FALLBACK_SCAN_ROWS) break;
```

All three functions use the same unbounded `.range` loop pattern (pageSize=1000, unlimited pages). The cap prevents degradation to 15+ round-trips if the RPC path is unavailable. Silent truncation at 5,000 rows is acceptable for fallback — the RPC path handles the real workload.

#### P2.3: Function-based Vite manualChunks

**File:** `vite.config.js`

Replace the object-based `manualChunks` with a function that matches by module path, which is more reliable than specifier strings:

```js
manualChunks(id) {
  if (id.includes("node_modules/react-dom")) return "vendor-react";
  if (id.includes("node_modules/react/")) return "vendor-react";
  if (id.includes("node_modules/@tanstack")) return "vendor-query";
  if (id.includes("node_modules/react-router")) return "vendor-router";
  if (id.includes("node_modules/@duckdb")) return "vendor-duckdb";
},
```

This ensures React/ReactDOM actually land in `vendor-react` instead of the 0-byte chunk seen today.

If `lucide-react` isn't tree-shaken effectively, add a catch-all:
```js
if (id.includes("node_modules/lucide-react")) return "vendor-lucide";
```
Verify with `npm run build` that chunks are populated as expected.

---

### P3 — Deferred (hours)

- **Virtualize CardGrid** with `@tanstack/react-virtual` — only mount ~24–40 visible tiles
- **Extract CardDetail from ExplorePage render tree** — render at layout level via portal or URL state
- **Two-phase image load in CardDetail** — show `image_small` immediately, swap to `image_large` after preload
- **CardDetail `placeholderData` optimization** — `queryClient.getQueriesData({ queryKey: ["cards"] })` scans all cached pages; could get expensive with many cached page queries
- **Explore `["attributes"]` query `staleTime`** — currently no staleTime; adding one is a cheap win for repeated visits to Explore

---

## Go/No-Go Gate

- [ ] `npm run check:quick` passes (build + all tests)
- [ ] Production build produces separate chunks per route (not one 993KB index.js)
- [ ] DuckDB WASM is NOT in the network tab on first Supabase page load
- [ ] v1/DuckDB mode still works: `initDB()` → `duck.initDB()` loads WASM and queries DuckDB correctly
- [ ] Explore grid loads without `count: exact` requests in network tab (planned counts only)
- [ ] Page clamp + "page N of M" display still functional with planned counts
- [ ] Existing Explore filter/pagination/prefetch behavior unchanged
- [ ] All 11 routes navigate correctly (no blank screens from broken lazy boundaries)

---

## Rollback

- Revert each commit individually (changes are independent)
- `git revert` is safe — no schema changes, no data migration
- Can also re-enable `exact_count` by reverting line 312 to `USE_SUPABASE_APP`

---

## Files Touched

| File | Change |
|---|---|
| `src/pages/ExplorePage.jsx` | P0.1: exact_count → false, add missing `fetchCard` import, optional `placeholderData` swap |
| `src/db.js` | P0.2: static → dynamic DuckDB import |
| `src/App.jsx` | P0.3: React.lazy for 8 non-auth routes |
| `src/components/CardGrid.jsx` | P1.1: React.memo(CardItem) + decoding="async" |
| `src/data/supabase/appAdapter.js` | P2.2: cap fallback scans at 5000 rows |
| `vite.config.js` | P2.3: function-based manualChunks |
