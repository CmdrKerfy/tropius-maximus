# Card Detail Speed & Pagination Redesign

## Context

Explore page performance fixes are done (planned count, lazy images, scroll-to-top, prefetch). But card detail modal loading is still sluggish, and pagination at 400+ pages is awkward with the 7-button window design.

This plan achieves two-phase card detail loading and a compact pagination bar **without new RPCs or migrations** — just narrower PostgREST selects and UI changes.

---

## Phase 1: Card Detail Speed

### 1.1 Narrow `fetchCard` select to exclude `raw_data`

**File:** `src/data/supabase/appAdapter.js`

Current `fetchCard` uses `*` which pulls the full `raw_data` JSONB column. Replace with an explicit column list:

```js
// Current
.select("*, profiles!cards_created_by_fkey(display_name), annotations(*, profiles!annotations_updated_by_fkey(display_name))")

// Proposed
.select("id, name, set_id, set_name, number, image_small, image_large, supertype, subtypes, hp, types, evolves_from, rarity, artist, element, format, regulation_mark, prices, origin, origin_detail, created_by, set_series, number_sort_key, card_type, illustrator, weaknesses, resistances, retreat_cost, tcgplayer_url, last_seen_in_api, profiles!cards_created_by_fkey(display_name), annotations(*, profiles!annotations_updated_by_fkey(display_name))")
```

Everything except `raw_data`. This is the single biggest payload reduction — `raw_data` is often 50-200KB of JSON.

### 1.2 Add `fetchCardRawData(id)` companion function

**File:** `src/data/supabase/appAdapter.js`

A tiny function for lazy-loading just the heavy part:

```js
export async function fetchCardRawData(id) {
  const sb = await sbReady();
  const { data, error } = await sb
    .from("cards")
    .select("id, raw_data")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data?.raw_data && typeof data.raw_data === "object" ? data.raw_data : {};
}
```

### 1.3 Two-phase loading in CardDetail

**File:** `src/components/CardDetail.jsx`

- **Phase 1:** `useQuery` with `fetchCard` (narrow, no raw_data) renders instantly — image, name, set, annotations, overrides.
- **Phase 2:** Background `useQuery` with `fetchCardRawData`, enabled when phase 1 succeeds. On success, populates attacks, abilities, weaknesses, rules, flavor text. A small spinner in the Info tab while raw_data loads.

```jsx
// Phase 1: fast, no raw_data
const { data: card, isPlaceholderData } = useQuery({
  queryKey: ["cardDetail", cardId, source],
  queryFn: () => fetchCard(cardId, source),
  placeholderData: () => gridPlaceholderFor(cardId),
  staleTime: 5 * 60_000,
  refetchOnWindowFocus: false,
  gcTime: 10 * 60_000,
});

// Phase 2: lazy raw_data
const { data: rawData } = useQuery({
  queryKey: ["cardDetailRaw", cardId],
  queryFn: () => fetchCardRawData(cardId),
  enabled: !!card && !isPlaceholderData,
  staleTime: 5 * 60_000,
  refetchOnWindowFocus: false,
});
```

### 1.4 Grid placeholderData for instant modal open

**File:** `src/pages/ExplorePage.jsx` and `src/components/CardDetail.jsx`

When a card is clicked in the grid, the grid row already has `image_small`, `name`, `set_name`, `number`, and flattened annotations. Pass this as `placeholderData` to CardDetail's `useQuery` so the modal opens with the image and title already visible — no skeleton, no spinner.

The placeholder shape should be compatible with how CardDetail reads its data. If the grid row and the detail row have different shapes, add a thin transform in the `placeholderData` callback.

### 1.5 Query policy & refresh button

**File:** `src/components/CardDetail.jsx`

Both phase 1 and phase 2 queries:
- `staleTime: 5 * 60_000` (5 min)
- `refetchOnWindowFocus: false`
- `gcTime: 10 * 60_000`

Add a small circular-arrow Refresh button in the modal header. On click:
```js
queryClient.invalidateQueries({ queryKey: ["cardDetail", cardId] });
queryClient.invalidateQueries({ queryKey: ["cardDetailRaw", cardId] });
```

### 1.6 Image layout stability

**File:** `src/components/CardDetail.jsx`

Replace fixed pixel dimensions on the main card image with an aspect-ratio box + `object-contain`:

```jsx
<div className="aspect-[2.5/3.5] w-full">
  <img
    src={...}
    className="w-full h-full object-contain"
    decoding="async"
    fetchpriority="high"
    ...
  />
</div>
```

This prevents layout shift as the image decodes, and odd-sized promos/jumbos letterbox instead of reflowing the modal.

### 1.7 Prev/next detail prefetch

**File:** `src/pages/ExplorePage.jsx`

When the modal is open and the current card has a prev/next neighbor in the grid, prefetch their detail queries:

```js
useEffect(() => {
  if (!selectedCardId) return;
  const idx = displayedCards.findIndex(c => c.id === selectedCardId);
  if (idx > 0) {
    queryClient.prefetchQuery({
      queryKey: ["cardDetail", displayedCards[idx - 1].id, source],
      queryFn: () => fetchCard(displayedCards[idx - 1].id, source),
      staleTime: 5 * 60_000,
    });
  }
  if (idx < displayedCards.length - 1) {
    queryClient.prefetchQuery({
      queryKey: ["cardDetail", displayedCards[idx + 1].id, source],
      queryFn: () => fetchCard(displayedCards[idx + 1].id, source),
      staleTime: 5 * 60_000,
    });
  }
}, [selectedCardId, displayedCards, source, queryClient]);
```

---

## Phase 2: Pagination Redesign

### 2.1 Compact bar with jump input

**File:** `src/components/Pagination.jsx`

Replace the 7-button numbered window with a compact bar:

```
‹ Previous   Page 40 of 417   [___]   Next ›
```

- Previous/Next buttons (disabled at boundaries)
- "Page X of Y" plain text
- A 3.5rem-wide number input for direct jumps
- On Enter or blur: clamp value to [1, totalPages], call `onPageChange`
- On invalid input (letters, empty): silently clamp to current page
- Hide entirely if totalPages ≤ 1

### 2.2 Keyboard shortcuts (scoped)

**File:** `src/components/Pagination.jsx`

When the pagination bar or jump input is focused:
- `←` → prev page (if not at page 1)
- `→` → next page (if not at last page)
- `Home` → page 1
- `End` → last page

NOT global shortcuts — they must not fire when the user is typing in the Explore search box or a card detail field.

### 2.3 pageSize: 60 → 120

**File:** `src/pages/ExplorePage.jsx:184`

```js
const [pageSize] = useState(120);
```

Cuts page count from ~417 to ~209. Lazy image loading means the 60 extra below-the-fold images won't eager-load. Verify:
- URL `?page=` clamp still works with new pageSize
- Batch cap copy doesn't hardcode 60
- Grid render performance is acceptable with 120 DOM nodes

---

## Verification

### Phase 1
1. Click a card in Explore → modal opens with image + title visible immediately (no spinner)
2. Info tab shows a small spinner while attacks/abilities load in the background
3. After loading, clicking between tabs is instant (no refetch)
4. Refresh button in header re-fetches and updates data
5. Tab away and back → no refetch lag (focus refetch disabled)
6. Prev/Next arrows in modal → instant navigation (prefetched)

### Phase 2
1. Page bar shows "Page X of Y" with Previous/Next and jump input
2. Typing a page number and pressing Enter navigates correctly
3. Invalid input (0, 9999, letters) clamps gracefully
4. Keyboard ←/→ works when pagination bar is focused
5. Keyboard shortcuts don't fire when typing in search/filter inputs

---

## What this plan does NOT do

- **No new RPCs or migrations** — uses narrower PostgREST selects instead
- **No mojibake cleanup at ingest** — separate future task
- **No cursor/keyset pagination** — only address if high-page DB cost is still felt after pageSize bump
- **No infinite scroll** — worse than jump input for a 25K catalog
