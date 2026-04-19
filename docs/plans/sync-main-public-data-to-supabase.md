# Sync `main` static data into v2 + Supabase (testing)

When **GitHub Pages / `main`** has newer **ingest output** (`public/data/*.parquet`, `pokemon.duckdb`) or **`custom_cards.json`** than **`v2/supabase-migration`**, use this flow so Vercel + Supabase match the live site for QA.

## 1. Git: pull `public/data` from `main` into your branch

```bash
git fetch origin main
git checkout origin/main -- public/data/
git add public/data/
git commit -m "Sync public/data from main (ingest + custom cards)"
```

This updates (typical): `custom_cards.json`, `*.parquet`, `pokemon.duckdb`, `data_meta.json`, `annotations.json`, etc.

## 2. Supabase: API-sourced cards & sets (e.g. new sets like **me3**)

Uses the checked-in **DuckDB** (same path as ingest: `public/data/pokemon.duckdb`).

```bash
export SUPABASE_URL=https://YOUR_PROJECT.supabase.co
export SUPABASE_SERVICE_KEY=your_service_role_secret   # never commit

python scripts/push_duckdb_to_supabase.py
# or: python scripts/push_duckdb_to_supabase.py --dry-run
```

This **upserts** `sets`, `cards` (`pokemontcg.io` / `tcgdex`), and `pokemon_metadata`. It does **not** replace manual (`origin = manual`) rows except when the same `id` exists (upsert by PK).

## 3. Supabase: custom (manual) cards from `custom_cards.json`

`migrate_data.py` reads **`backup/custom_cards.json`** (gitignored). Copy from the repo file you just synced:

```bash
cp public/data/custom_cards.json backup/custom_cards.json
# optional: normalize set ids
python scripts/normalize_custom_cards_json.py backup/custom_cards.json

python scripts/migrate_data.py --custom-cards-only
# or: python scripts/migrate_data.py --custom-cards-only --dry-run
```

This upserts **manual** `cards`, related **`sets`** stubs, and **`annotations`** embedded in the JSON.

## 4. Verify

- Explore: filter by new set (e.g. **Perfect Order** / `me3`).
- Search for a known custom card id from `custom_cards.json`.

## Notes

- **Service role** env vars are only for local/CI use; never commit.
- Full **one-shot** DB load (`migrate_data.py` without flags) still expects **`backup/*.csv`** snapshots; for incremental sync from live **main**, prefer **§2 + §3** above.
