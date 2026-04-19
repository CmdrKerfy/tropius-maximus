# Plan: TCG data refresh & missing sets coverage

## Context

- Users report missing recent products (e.g. **Mega Evolution—Perfect Order**, Mega Evolution promos).
- Card data is **not scraped** from arbitrary sites; it comes from **`scripts/ingest.py`** → **pokemontcg.io** + **PokemonTCG/pokemon-tcg-data** (set / card file index).
- **Perfect Order** exists on the API as set id **`me3`** (124 cards as of API check). If it is missing on the live site, the **bundled Parquet / last ingest** is behind—not a missing API.
- Explore shows **“Data last updated (card snapshot)”** from `public/data/data_meta.json`, written when **`ingest.py`** completes.

## Goals

1. **Refresh** local DuckDB + Parquet so new sets (including `me3`) appear in Explore.
2. **Document** a repeatable verification path (API vs local DB vs upstream GitHub file list).
3. **Reduce repeat confusion** via CI/docs and optional scheduling.

## Phase 1 — Local refresh (owner / dev machine)

1. **Prereqs:** Python env with `httpx`, `duckdb`; optional `POKEMON_TCG_API_KEY` for rate limits.
2. From repo root:
   - `python scripts/ingest.py`  
     - Fills **missing** sets by default; skips sets that already meet expected counts.  
     - To **only** pull one set: `python scripts/ingest.py --set me3`.  
     - Full re-download: `python scripts/ingest.py --force` (slow; use if data is corrupt/partial).
3. **Export** static assets the browser loads:
   - `python scripts/export_parquet.py`  
   - Confirms non-custom TCG card count is above the script’s safety floor.
4. **Commit** updated `public/data/*.parquet`, `public/data/data_meta.json`, and DuckDB if you version it (per project conventions).
5. **Smoke test:** open Explore, filter by set **Perfect Order** / id `me3`, confirm card count reasonable.

## Phase 2 — Verification checklist (when a set is “missing”)

| Check | Action |
|--------|--------|
| Set exists on API | `GET https://api.pokemontcg.io/v2/sets?orderBy=-releaseDate` or `GET .../cards?q=set.id:me3&pageSize=1` |
| Set is in ingest index | `cards/en` listing in **PokemonTCG/pokemon-tcg-data** includes `<id>.json` (e.g. `me3`) |
| Local DB has cards | After ingest: query DuckDB `SELECT COUNT(*) FROM tcg_cards WHERE set_id = 'me3'` |
| `failed_sets` | If ingest failed, row in `failed_sets`; may need `--clear-failed` and retry |
| Parquet actually updated | `export_parquet.py` ran after ingest; site loads Parquet, not DuckDB directly in production |

## Phase 3 — Promos & edge cases

- **Product-only promos** may use **different set ids** on the API; search by name or known id on pokemontcg.io.
- If a set **never** appears in **pokemon-tcg-data** `cards/en`, **ingest will not** pick it up until upstream adds the file—then re-run ingest.
- **Manual / custom** cards remain the path for items not in the API.

## Phase 4 — CI & automation (optional)

1. Confirm **GitHub Actions** workflow that runs ingest (if any) runs **`ingest.py`** then **`export_parquet.py`**, then commits or artifacts Parquet.
2. **Schedule:** e.g. weekly ingest on a branch or `main` per release cadence.
3. **Document** in README or ops doc: env vars (`POKEMON_TCG_API_KEY`), `SUPABASE_*` if pushing to Supabase (`--push-supabase`).

## Phase 5 — v2 / Supabase (defer / batch)

- Not required for the **same** Explore bug class if **`sets`** is the source of truth and data is migrated.
- When **custom card insert** is implemented: apply **canonical set id** normalization (see `scripts/manual_set_normalize.py` / migration 009 patterns) on save.
- Merge shared **JS** fixes (e.g. `mergeExploreFilterOptions`) from `main` when cutting v2.

## Success criteria

- **Perfect Order (`me3`)** visible in Explore after refresh + deploy (or equivalent new sets users asked for).
- **`data_meta.json`** shows a recent **lastUpdated** after ingest.
- **Runbook** (this plan + Phase 2 table) answers “is it the API or us?” without ad-hoc debugging.

## Tracking

- [ ] Local ingest + export completed; Parquet committed.
- [ ] Live site (or staging) shows updated snapshot date and new sets.
- [ ] CI/schedule documented or ticket filed if not automated.
- [ ] v2 follow-up items captured or explicitly deferred.
