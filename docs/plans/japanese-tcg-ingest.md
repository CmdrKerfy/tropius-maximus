# Japanese TCG Card Ingest

## Context

The current ingest only fetches English sets from pokemontcg.io. Japanese-exclusive sets (SM12A Tag All Stars, SM11A, etc.) are entirely missing. tcgdex has full Japanese coverage at `/v2/ja/sets` and `/v2/ja/cards`, and the app already uses tcgdex for Pocket cards — so no new API integration is needed.

## Source filter dropdown (current → proposed)

| Source Filter | origin | origin_detail | Change |
|---|---|---|---|
| All | `pokemontcg.io`, `manual`, `tcgdex` | (any) | None |
| TCG | `pokemontcg.io`, `manual` | (any) | None |
| **TCG (JPN)** | `tcgdex` | `japanese` | **New** |
| Pocket | `tcgdex` | `IS DISTINCT FROM japanese` | Narrowed to exclude JP |
| Custom Cards | `manual` | `IS NULL` or `NOT pokumon` | None |
| Promo | `manual` | `pokumon` | None |

## Phase 1: Ingest pipeline

### 1.1 Add Japanese sets to DuckDB ingest

**File:** `scripts/ingest.py`

The current `ingest_sets()` only fetches `en.json` from the Pokemon TCG GitHub. Add a tcgdex-based Japanese sets ingestion alongside it:

- Call `https://api.tcgdex.net/v2/ja/sets` to get all Japanese sets
- Insert/upsert into the `sets` table with `origin = 'tcgdex'`, `origin_detail = 'japanese'`
- Skip sets that already exist in DuckDB under a different origin (avoid double-counting the same set ID)

### 1.2 Fetch Japanese cards from tcgdex

**File:** `scripts/ingest.py`

For each Japanese set, fetch cards from `https://api.tcgdex.net/v2/ja/sets/{setId}` or `/v2/ja/cards?set={setId}`:

- Normalize into the standard `cards` schema
- Set `origin = 'tcgdex'`, `origin_detail = 'japanese'`
- Set `format = 'printed'` (these are physical cards, not digital Pocket cards)
- Use images from tcgdex assets

### 1.3 Push Japanese data to Supabase

**File:** `scripts/push_duckdb_to_supabase.py`

Add a `push_japanese_cards()` function (similar to `push_tcg_cards()` and `push_pocket_cards()`):

- Pull from DuckDB where `origin = 'tcgdex'` AND `origin_detail = 'japanese'`
- Upsert into Supabase `cards` table
- Upsert into Supabase `sets` table
- No risk of overwriting English cards — Japanese sets have different set IDs

## Phase 2: App layer

### 2.1 Add TCG (JPN) to source filter dropdown

**File:** `src/components/FilterPanel.jsx`

Add `<option value="TCG (JPN)">TCG (JPN)</option>` to the hardcoded source select.

### 2.2 Add TCG (JPN) filter logic

**File:** `src/data/supabase/appAdapter.js`

In the `fetchCards` source filter block:
- **TCG (JPN)**: `query.eq("origin", "tcgdex").eq("origin_detail", "japanese")`
- Narrow **Pocket**: `query.eq("origin", "tcgdex").or("origin_detail.is.null,origin_detail.neq.japanese")`
- All other filters unchanged

### 2.3 Explore filter options (if needed)

**File:** migration `020_explore_filter_options_rpc.sql` or appAdapter fallback

The Pocket section of the RPC currently queries `origin = 'tcgdex'`. After this change, Pocket should exclude Japanese cards. Review whether the RPC needs updating or if the existing distinct values work as-is.

## Phase 3: Verification

1. Run ingest — confirm Japanese sets appear in DuckDB with `origin_detail = 'japanese'`
2. Push to Supabase — confirm `sm12a-*` cards appear alongside existing cards
3. Explore page — TCG (JPN) dropdown option filters to Japanese cards only
4. Pocket dropdown option — shows Pocket cards, no Japanese mixed in
5. All dropdown option — includes everything (English + Japanese + Pocket + Custom + Promo)
6. Sample check: SM12A Tag All Stars cards are findable

## Risks

- **tcgdex rate limits** — unknown; add delays between requests as with Pokumon
- **Image URLs** — tcgdex assets may be slow or unavailable for some older Japanese sets
- **Card name encoding** — Japanese names may include characters that need UTF-8 handling
- **Set ID collisions** — unlikely (Japanese sets have unique IDs like `sm12a`, `sv1S`), but verify before upserting sets
