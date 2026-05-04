# Explore Performance & Pagination Fixes

## Context

~25,000 cards in Supabase (15,000 API + 10,000 Pokumon). Explore page has noticeable lag on page changes, especially at high page numbers. Pagination bar "shifts left" without refreshing the grid, scroll position isn't reset, and images load eagerly.

**Related plan:** [Japanese TCG ingest](japanese-tcg-ingest.md) — adding TCG (JPN) source filter via tcgdex.

## Prerequisite: ANALYZE (run in Supabase SQL Editor)

After bulk-loading Pokumon cards, Postgres planner stats are stale. Run this once:

```sql
ANALYZE cards;
ANALYZE annotations;
```

Without this, `count: "planned"` gives bad estimates and indexes may not be used.

---

## Phase 1: Core fixes (highest impact, least code)

### 1. Switch Explore grid to `count: "planned"`

**File:** `src/pages/ExplorePage.jsx:325`

Change `exact_count: true` to `exact_count: false` (or remove the spread entirely). Postgres planner estimates are close enough for filtered queries, and the pagination UX doesn't need an exact total. The page-clamp `useEffect` on line 357 already handles the edge case of a stale page past the last page.

The constant can be moved to make it easy to flip back for debugging:
```js
const EXPLORE_EXACT_COUNT = false;
```

### 2. Add `isFetching` visual feedback during page changes

**File:** `src/pages/ExplorePage.jsx:311-328`

`keepPreviousData` keeps old cards visible during fetches with no loading indicator. Destructure `isFetching` from `useQuery` and pass it to the grid area so the user sees something is happening:

```jsx
const { ..., isFetching } = useQuery({ ... });
```

Pass `isFetching` to a wrapper around `<CardGrid>` — a subtle opacity reduction or a thin progress bar at the top of the grid while `isFetching && !listAwaitingFirstData` (only when replacing existing data, not the initial load).

### 3. Scroll to top on page change

**File:** `src/pages/ExplorePage.jsx`

Add a `useEffect` that fires on `page` change:

```js
useEffect(() => {
  window.scrollTo({ top: 0, behavior: "instant" });
}, [page]);
```

Or better, scroll the explore content area into view so the user lands at the top of the filter bar + grid.

### 4. Add `loading="lazy"` to card images

**File:** `src/components/CardGrid.jsx:96`

Add `loading="lazy"` to the `<img>` tag. Native browser feature, zero dependencies. Off-screen images will defer until they're about to enter the viewport.

### 5. Remove `raw_data` from grid select

**File:** `src/data/supabase/appAdapter.js:802`

Remove `raw_data` from the `select` string in `fetchCards`. The grid never renders it — only `CardDetail` uses it, and `CardDetail` fetches via `fetchCard` separately.

---

## Phase 2: Follow-up improvements

### 6. Adjacent-page prefetch

**File:** `src/pages/ExplorePage.jsx`

After the current page query succeeds, prefetch adjacent pages:

```js
useEffect(() => {
  if (page > 1) {
    queryClient.prefetchQuery({
      queryKey: ["cards", searchQuery, filters, page - 1, pageSize],
      queryFn: () => fetchCards({ ... }),
    });
  }
  if (page < totalPages) {
    queryClient.prefetchQuery({
      queryKey: ["cards", searchQuery, filters, page + 1, pageSize],
      queryFn: () => fetchCards({ ... }),
    });
  }
}, [page, searchQuery, filters, pageSize, totalPages]);
```

Sequential pagination (Prev/Next) then feels instant.

### 7. Stable pagination button widths

**File:** `src/components/Pagination.jsx`

Give page number buttons a fixed minimum width so the bar doesn't "jump" when switching between single-digit and multi-digit page numbers:

```jsx
className: "min-w-[2.25rem]"
```

This reduces the visual jarring when the number window shifts.

---

## Phase 3: OG image share preview reliability

iMessage/WhatsApp thumbnails inconsistently appearing. Two failure modes:
- **Missing `og:image:width`/`height`** — currently only emitted for the placeholder. iMessage requires these; without them, behavior varies per scraper instance.
- **Unfetchable image URLs** — WordPress/Pokumon images can timeout, 403, or be too large for messenger scrapers. The OG HTML always points at the raw image URL today with no pre-validation.

### 8. Validate image reachability before serving OG tags

**File:** `api/share-og.js`

Before emitting `og:image` pointing to a third-party URL, do a quick reachability check:
- Try HEAD first
- Fall back to GET with a small `Range` header if HEAD returns 405
- Abort after receiving response headers (don't download the full image)
- Check status is 2xx and `Content-Length` is under ~5MB
- If unreachable, serve the placeholder instead

This guarantees every `og:image` tag points to a URL the messenger scraper can actually fetch.

```js
async function checkImageReachable(url) {
  try {
    // HEAD first
    let res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5000) });
    // Some hosts return 405 for HEAD — fall back to GET with Range
    if (res.status === 405) {
      const ctrl = new AbortController();
      res = await fetch(url, {
        headers: { "Range": "bytes=0-0" },
        signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(5000)]),
      });
      // Abort after headers arrive — we only need status + content-length
      ctrl.abort();
    }
    if (!res.ok) return false;
    const len = res.headers.get("content-length");
    if (len && parseInt(len, 10) > 5_000_000) return false; // >5MB
    return true;
  } catch {
    return false;
  }
}
```

### 9. Add `og:image:width` and `og:image:height` for real images

**File:** `api/share-og.js:126-128`

Currently `ogImageDims` is empty for real images. Use standard Pokemon card dimensions (~734×1024) as defaults. The RPC should also return `media_meta` dimensions when available for accuracy, but the default alone fixes the "missing tags" problem.

```js
// Standard Pokemon card aspect ratio; real dims from RPC are better but any
// dimensions are dramatically better than none for iMessage/WhatsApp.
const ogImageDims = usePlaceholder
  ? `  <meta property="og:image:width" content="${OG_PLACEHOLDER_WIDTH}">\n  <meta property="og:image:height" content="${OG_PLACEHOLDER_HEIGHT}">\n`
  : `  <meta property="og:image:width" content="734">\n  <meta property="og:image:height" content="1024">\n`;
```

### 10. Prefer smaller image variant from `media_meta`

**File:** `supabase/migrations/043_public_share_fuzzy_image_paths.sql` (revision) and `api/share-og.js`

The RPC should prefer `media_meta.sizes.medium.source_url` or `media_meta.sizes.large.source_url` over the full-size image when available (smaller payload = faster scraper fetch = less timeout risk). Add `media_meta` to the RPC return so the OG endpoint can use it.

---

## Not in scope (separate work)

- **DuckDB/WASM bundle split** — Supabase-only users still download the DuckDB WASM binary. A bundle-split task for later.
- **Artist filter secondary query** — Requires an RPC to fold into a single round-trip. More complex than the benefit warrants given the 30-min `staleTime`.
- **Data Health** — Slow by design on large tables; batch/off-peak by nature.
- **Image proxy through Vercel** — Only warranted if #8-10 don't resolve the OG issues.

---

## Verification

### Explore performance (Phases 1-2)
1. Click a high page number — grid should refresh with a subtle loading indicator, then scroll to top
2. Network tab: card query should no longer include a trailing COUNT(*) round-trip
3. Images below the fold should load lazily (visible in Network tab as deferred requests)
4. Pagination buttons should feel responsive, not "delayed"

Phase 2 adds prefetch warmth for sequential navigation.

### OG image previews (Phase 3)
1. Share a Pokumon card link in iMessage — thumbnail should appear within 2-3 seconds
2. Share a card with a known-broken image URL — placeholder should appear instead of a blank thumbnail
3. Share an API card link — should still work as before
4. Use WhatsApp's "Generate Link Preview" or share a link — thumbnail should appear consistently
