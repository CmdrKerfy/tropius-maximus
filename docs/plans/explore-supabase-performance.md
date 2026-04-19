# Plan: Explore performance on v2 (Supabase + Vercel)

## Context

- **v1 (GitHub Pages + DuckDB-WASM):** Card data is local after load; filters and grid queries run in-process with minimal per-action latency.
- **v2 (`VITE_USE_SUPABASE=true`):** Explore uses PostgREST round trips. Two patterns dominate slowness:
  1. **Filter options** are built by **client-side paging** through large tables (`distinctColumn` / `distinctAnnotationColumn` in `src/data/supabase/appAdapter.js`) — many HTTP requests and redundant bytes.
  2. **Grid loads** combine **exact row counts**, **wide selects + optional `annotations` joins**, **`ilike` name search**, and **follow-up profile lookups** — extra latency and server work per page/search.

This plan orders work by **impact vs effort** and keeps **RLS/security** aligned with existing policies.

## Goals

1. **First load / filter bar:** Options appear quickly without scanning entire tables from the browser.
2. **Grid / pagination / search:** Per interaction feels responsive; avoid unnecessary exact counts and round trips where possible.
3. **Card detail:** Minimize sequential network hops for the common path (or overlap them cleanly).
4. **Measurable:** Before/after checks (Network tab request counts, time to interactive filter dropdowns, grid TTFB) documented for the owner.

## Non-goals (for this plan)

- Rewriting Explore UI or abandoning TanStack Query.
- Matching DuckDB “zero latency” — remote Postgres will always have RTT; the target is **good enough** UX with **sane** server work.
- Broad refactors of `db.js` / DuckDB path unless needed for shared types.

---

## Phase 1 — Server-side filter options (highest impact) — **implemented**

**Problem:** `fetchExploreFilterOptions` called `fetchFilterOptions` for TCG, Pocket, and Custom; scalar distincts used **paginated full-table reads** (`distinctColumn` / `distinctAnnotationColumn`).

**What shipped:**

1. **Migration `020_explore_filter_options_rpc.sql`:** `public.get_explore_filter_options_db()` returns **one JSONB** with `tcg` / `pocket` / `custom` blobs (distincts via SQL `SELECT DISTINCT` + `jsonb_agg`, no client paging). **`SECURITY INVOKER`** so RLS applies; **`GRANT EXECUTE`** to **`authenticated`** and **`service_role`** only (aligned with migration **019** — no anon Explore).
2. **`src/data/supabase/appAdapter.js`:** `fetchExploreFilterOptions` calls **`supabase.rpc('get_explore_filter_options_db')`**, then **`mergeExploreFilterOptions`** after merging **static** lists from `annotationOptions.js` (`PKMN_REGION_OPTIONS`, `WEATHER_OPTIONS`, etc.) and **`mergeEvolutionLines`** on the server-provided evolution strings — same behavior as before.
3. **Fallback:** If the RPC is missing or errors (e.g. migration not applied locally), the app logs a warning and uses the **legacy client-paged** path so dev does not hard-fail.

**Success criteria:** Loading Explore uses **one** PostgREST **`rpc`** call for filter options instead of dozens of paged selects — verify in Network tab after applying **020** to Supabase.

---

## Phase 1b — Form options + cache alignment — **implemented**

**Problem:** `fetchFormOptions` used **`distinctColumn`** + **`mergeAnnotationUsageIntoOptions`** (full annotation table paging). **`CardDetail`** and **`CustomCardForm`** loaded options in **`useEffect`**, duplicating Workbench traffic.

**What shipped:**

1. **Migration `021_form_options_rpc.sql`:** `public.get_form_options_db()` returns JSONB: TCG **`cards`** distincts (`rarity`, `artist`, `name`), all **`sets`** rows, **`pokemon_metadata`** regions / names / evolution text, and **per-column** distincts for annotation JSONB (via `jnorm` + `jsonb_array_elements_text`) and TEXT columns. **`SECURITY INVOKER`**, **`GRANT EXECUTE`** to **`authenticated`** + **`service_role`**.
2. **`appAdapter.js`:** `fetchFormOptions` → **`supabase.rpc('get_form_options_db')`** → **`buildFormOptionsFromRpcPayload`** + **`mergeAnnotationUsageIntoOptionsFromRpc`**; fallback **`fetchFormOptionsClientPaged`** if RPC fails.
3. **`FORM_OPTIONS_QUERY_KEY`** exported from **`src/db.js`**; **`WorkbenchPage`**, **`CardDetail`**, **`CustomCardForm`** use **`useQuery`** (`staleTime: 300_000`). **`BatchEditPage`** invalidates that key after batch runs.

**Success:** One **`rpc`** call for form options (after cache miss) instead of many paged reads; modal/custom form reuse Workbench cache when possible.

---

## Phase 2 — Grid query cost: counts, search, indexes — **implemented**

**Problem:** Every grid request used **`count: "exact"`**; `ilike('%…%')` on **`name`** is expensive at scale without a trigram index.

**What shipped:**

1. **`fetchCards`** (`appAdapter.js`): optional **`exact_count`** (default **`false`**). Explore uses PostgREST **`count: "planned"`** (planner estimate — faster than exact). **`exact_count: true`** uses **`count: "exact"`** for **batch match count** (`BatchEditPage`) and **`fetchMatchingCardIds`** so typed confirmations and ID walks stay accurate.
2. **Migration `022_grid_search_indexes.sql`:** **`pg_trgm`**, **GIN** index **`idx_cards_name_trgm`** on **`cards.name`**, composite **`idx_cards_origin_set_id`** on **`(origin, set_id)`**.
3. **UI:** Explore still shows **“X cards found”** from the planned count (usually close to exact; can differ slightly under heavy stats skew). Pagination uses the same total.

**Success:** Fewer full-table counts on Explore; name search and origin+set filters can use new indexes after **`022`** is applied.

---

## Phase 3 — Profile display names and extra round trips — **implemented**

**Problem:** Each `fetchCards` page and `fetchCard` did a **second** `profiles` query via **`fetchProfileDisplayNamesByIds`**.

**What shipped:**

1. **Migration `023_cards_annotations_profiles_fk.sql`:** **Apply this migration on every environment** (local Supabase, staging, production) before relying on profile embeds — until then PostgREST returns *“Could not find a relationship between 'cards' and 'profiles'”*. Same rollout habit as **020**–**022**.  
   The migration: backfills missing **`profiles`** rows for any **`cards.created_by`** / **`annotations.updated_by`** UUIDs; clears orphan FKs; replaces **`cards.created_by`** and **`annotations.updated_by`** FKs from **`auth.users`** to **`public.profiles(id)`** (`ON DELETE SET NULL`). Enables PostgREST resource embedding with stable hint names **`cards_created_by_fkey`** and **`annotations_updated_by_fkey`**.
2. **`appAdapter.js`:** **`fetchCards`** and **`fetchCard`** select **`profiles!cards_created_by_fkey(display_name)`** and nested **`profiles!annotations_updated_by_fkey(display_name)`** on **`annotations`**. **`displayNameFromProfileEmbed`** + **`gridRowFromCard(row)`** (no second hop). **`fetchProfileDisplayNamesByIds`** removed.
3. **`annotationBridge.js`:** **`annotationRowToFlat`** strips embed **`profiles`** so flat annotation payloads stay clean.

**Success:** Grid and card detail attribution names come from the **same** PostgREST response as card rows (no extra `in(id, …)` profile round trip).

---

## Phase 4 — Card detail path — **implemented**

**Problem:** `fetchCard` always awaited **`pokemon_metadata`** after the main row, even for **Pocket** (`tcgdex`) cards where genus/metadata are unused — an extra round trip. **`CardDetail`** loaded the card in a **`useEffect`** + local state, so the card fetch did not share TanStack Query’s cache or run as cleanly in parallel with other modal queries as it could.

**What shipped:**

1. **`fetchCard` (`appAdapter.js`):** Detect **`origin === 'tcgdex'`** before the metadata query and **skip** `pokemon_metadata` entirely for Pocket. (Profiles stay embedded on the main `cards` select from Phase 3; no second profile hop.)
2. **`CardDetail.jsx`:** Card payload loads via **`useQuery`** with key **`['cardDetail', cardId, source]`**, **`staleTime: 60_000`**, so the request aligns with **`fetchFormOptions`**, **`fetchUserPreferences`**, and **`fetchProfile`** (same tick / shared cache behavior). Annotation and image saves update the cache with **`queryClient.setQueryData`**; visibility refresh uses **`invalidateQueries`** on that key.
3. **Deferred (still valid if needed later):** Optional RPC **`get_card_detail(id)`**; heavier skeleton / “defer annotation tab until options ready” polish.

**Success:** Pocket card opens skip one HTTP request; repeat opens reuse cached card detail when within `staleTime`; fewer ad-hoc `fetchCard` waterfalls from the modal.

---

## Phase 5 — Startup / prefetch behavior — **implemented**

**Problem:** `main.jsx` kicked off **`fetchExploreFilterOptions`** prefetch in the same turn as **`setReady(true)`**, so the filter-options request could contend with first paint / router mount even though the RPC is cheap (Phase 1).

**What shipped:**

1. **`src/main.jsx`:** Call **`setReady(true)` first**, then schedule prefetch via **`requestIdleCallback`** (fallback: **double `requestAnimationFrame`**) so the work runs after the browser can paint. **`timeout`** is **2500 ms** (Supabase) / **4000 ms** (DuckDB path) so the prefetch still runs soon on an idle-but-busy tab.
2. **Cache:** Same **`queryKey`** as **`ExplorePage`** (`["filterOptions", "explore"]`); TanStack Query **dedupes** with the page’s `useQuery` if both run close together.

**Deferred:** Removing prefetch entirely (rely only on Explore `useQuery`) — revisit only if profiling shows idle prefetch is unnecessary.

---

## Phase 6 — Verification & rollback — **implemented** (runbook + env flag)

This phase is **process + safety rails**, not new performance features. Ship checklist lives here; deploy smoke still overlaps **`docs/plans/e2e-vercel-smoke-checklist.md`** (Explore section).

### 1) Post-deploy verification (owner fills in)

Run on **signed-in** Supabase (non-anonymous per **019**). DevTools → **Network**, filter `rest` or your Supabase host.

| Check | How | Pass? |
|--------|-----|-------|
| Filter options RPC | One request whose URL or payload involves **`get_explore_filter_options_db`** (or RPC name in PostgREST path); **not** dozens of `cards?select=` pages | ☐ |
| Time to interactive filters | From navigation to **`/`** until filter dropdowns show real values (not only placeholders) — note rough **ms** | ☐ |
| Grid + count | First page of cards renders; total count sane (exact count on Explore per current app) | ☐ |
| Card detail | Open modal — image + title without long blank; Pocket card skips extra metadata hop (Phase 4) | ☐ |
| RLS / anon | Anonymous session: Explore catalog hidden per **019** (or signed-in only); no silent full catalog for anon | ☐ |
| Console | No red errors on cold load to Explore | ☐ |

**Optional baseline table** (repeat after infra changes):

| Date / deploy | Filter RPC requests (count) | Approx. TTI filters (ms) | Notes |
|----------------|-----------------------------|---------------------------|--------|
| | | | |

### 2) Rollback (app-only, no DB revert required)

| Situation | Action |
|-----------|--------|
| RPC broken / wrong results after deploy | Set **`VITE_USE_FILTER_OPTIONS_RPC=false`** on Vercel (or `.env.local`), **redeploy**. Adapter skips **`get_explore_filter_options_db`** and uses **`fetchExploreFilterOptionsClientPaged()`** (legacy paged distincts — slow but independent of RPC). |
| RPC missing (migration **020** not applied) | App already **falls back** with a console warning; apply **`020`** when ready. |
| Stricter rollback | Revoke **`GRANT EXECUTE`** on the function in Supabase (advanced); prefer env flag first. |

**Env:** **`VITE_USE_FILTER_OPTIONS_RPC`** — unset or any value except **`false`** = use RPC. Documented in **`.env.example`**.

### 3) Migrations note

**020**–**023** are additive / FK changes; rolling back SQL is rarely needed. **`019`** is policy tightening — follow **`docs/plans/production-hardening-anon-auth.md`** for prod.

### 4) Owner sign-off (unchanged)

Side-by-side **GitHub Pages (v1)** vs **Vercel (v2)** for the same workflows when you are ready; track in **`e2e-vercel-smoke-checklist.md`** or your own tracker.

---

## Success criteria (overall)

- [x] Filter options load with **O(1)** RPC (`get_explore_filter_options_db`) instead of paged client scans (Phase 1).
- [x] Form options RPC + shared `FORM_OPTIONS_QUERY_KEY` cache (Phase 1b).
- [x] Grid uses **planned** counts + **`022`** indexes (Phase 2); tune further if needed.
- [x] Grid + card detail: **`profiles`** display names via PostgREST embed after **`023`** (Phase 3).
- [x] Card detail: skip useless metadata round trip for Pocket; **`useQuery`** for card payload (Phase 4).
- [x] Startup: deferred Explore **filter-options** prefetch after first paint (`main.jsx` Phase 5).
- [x] Phase 6 **runbook** + optional **`VITE_USE_FILTER_OPTIONS_RPC=false`** rollback (see Phase 6 section).
- [ ] No regression in **RLS** / auth expectations for Explore *(owner: run Phase 6 table)*.
- [ ] Owner sign-off after side-by-side with GitHub Pages for the same workflows *(owner)*.

## File touch list (expected)

| Area | Files / locations |
|------|-------------------|
| RPC + indexes | `020`–`023` (filter + form RPCs + grid indexes + profile FKs for embed) |
| Adapter | `src/data/supabase/appAdapter.js` — explore + form RPCs, `fetchCards` / `fetchCard` (embed profiles), helpers |
| Bridge | `src/data/supabase/annotationBridge.js` — strip `profiles` embed in `annotationRowToFlat` |
| Query key | `src/db.js` — `FORM_OPTIONS_QUERY_KEY`; CardDetail / CustomCardForm / Workbench |
| Startup | `src/main.jsx` — prefetch tuning (optional, late) |
| UI | `src/pages/ExplorePage.jsx`, `src/components/CardDetail.jsx` — loading UX only as needed |
| Types | If TS types exist for filter shape; else JSDoc in adapter |

## Suggested order of execution

1. **Phase 1** (filter RPC) — **done** (`020` + `fetchExploreFilterOptions`).  
2. **Phase 1b** (form RPC + shared cache) — **done** (`021` + `FORM_OPTIONS_QUERY_KEY`).  
3. **Phase 2** (grid/search/indexes) — **done** (`022`, `exact_count`, `fetchCards` planned counts).  
4. **Phase 3** (profiles embed) — **done** (`023` + `fetchCards` / `fetchCard` select).  
5. **Phase 4** (detail path) — **done** (skip `pokemon_metadata` for Pocket; `CardDetail` `useQuery` + cache updates).  
6. **Phase 5** (startup prefetch) — **done** (`main.jsx`: `setReady` then idle/rAF-deferred `prefetchQuery` for Explore filter options).  
7. **Phase 6** — **done** (verification runbook + **`VITE_USE_FILTER_OPTIONS_RPC`** rollback flag in `appAdapter.js`; see Phase 6 section above).
