# Plan: Pokumon full import + periodic sync

**Status:** Draft — not started.

**Branch:** `v2/supabase-migration`

## Background

Pokumon.com has a public WordPress REST API at `https://pokumon.com/wp-json/wp/v2/card`. The pilot successfully imported 100 test cards using the three-phase pipeline:

1. `import_pokumon_promos.py` — fetch + normalize → JSON preview
2. `analyze_pokumon_pilot.py` + `generate_pokumon_staging_sql.py` → staging table load
3. `pokumon_phase3_pilot_insert.sql` — staging → `cards` + `sets` (UPSERT)

The API reports **10,813 total cards**. This plan covers importing all of them and keeping them in sync.

---

## Phase 1: Full import (manual, one-time)

### 1a. Harden the import script for bulk fetching

The current script has `limit = max(1, args.limit)` (line 267), so `--limit 0` becomes 1 and cannot mean "all." Before the full fetch, add:

- **`--all` flag** — fetch loop runs until API exhausts all pages (no limit-based break)
- **`--retries N`** (default 3) — retry failed requests with exponential backoff. Mandatory for `--all` mode; 109 sequential `_embed=1` calls against a WordPress site will hit rate limiting or Cloudflare protection.
- **`--delay-ms N`** (default 500) — pause between requests to avoid triggering rate limits

Use `httpx` with a `Retry` transport or manual loop with `time.sleep` and retry-on-failure logic. The fetch is idempotent (read-only), so restarting mid-way is safe.

### 1b. Fetch all cards

```bash
python scripts/import_pokumon_promos.py --all --output tmp/pokumon_full_preview.json
```

Expected: ~109 pages × 100 per page = ~10,813 cards. With 500ms delay between requests + retries, expect 2–5 minutes total.

### 1c. Analyze full dataset

```bash
python scripts/analyze_pokumon_pilot.py --input tmp/pokumon_full_preview.json --output-json tmp/pokumon_full_analysis.json --output-md tmp/pokumon_full_analysis.md
```

Check for: duplicate IDs, missing images/numbers, HTML entities in names.

### 1d. Generate staging SQL + load to Supabase

```bash
python scripts/generate_pokumon_staging_sql.py --chunk-size 2000 --input tmp/pokumon_full_preview.json --output tmp/pokumon_staging_load.sql
```

Add a `--chunk-size` flag (default 2000 rows) to `generate_pokumon_staging_sql.py` that emits multiple `BEGIN; … COMMIT;` blocks. A single INSERT with 10k rows + embedded JSON for `raw_data` can exceed 1–2 MB and hit Supabase SQL Editor paste limits or statement timeouts. Don't wait for the timeout to discover this.

If no staging table exists yet (new environment), run `scripts/pokumon_staging_review.sql` first to create it.

### 1e. Preflight check

Run `scripts/pokumon_import_id_preflight.sql` in Supabase SQL Editor. Should return 0 rows (no ID conflicts with non-Pokumon cards). If any rows appear, decide per-row whether to skip or rename the staging record_id.

### 1f. Insert into production

**Batch label:** Have `generate_pokumon_staging_sql.py` inject the batch label into the generated SQL based on the current date (e.g. `pokumon-full-2026-05-03`). This avoids anyone having to edit magic strings buried in the SQL body. The `pokumon_phase3_pilot_insert.sql` template should use a placeholder token (e.g. `__BATCH_LABEL__`) that the generator replaces in both `settings` CTEs and the post-insert footer query.

**`created_by`:** Explicitly set `created_by = NULL` in the INSERT. The column has no default, so omitting it already yields NULL, but being explicit is safer. For idempotent re-imports, also add `created_by = NULL` to the `DO UPDATE SET` clause so a re-run clears any mistakenly-set user attribution on existing rows.

**Post-insert footer query:** The validation `SELECT` at the bottom of `pokumon_phase3_pilot_insert.sql` should use the same injected batch label so it can't drift from the INSERT.

**What the INSERT does:**
- Creates new `sets` rows for any unseen Pokumon promo sets (ON CONFLICT upsert)
- Inserts/updates all staging rows into `cards` (ON CONFLICT by id, updates the listed fields: name, set_id, number, set_name, image_small, image_large, raw_data, origin, origin_detail, format, created_by — not created_at, prices, last_seen_in_api, or other unlisted columns)

Run in Supabase SQL Editor.

**Post-import check:**

```sql
SELECT count(*) FROM cards WHERE origin_detail = 'pokumon';
```

Expect ~10,813.

**Rollback (if import is bad):**

```sql
DELETE FROM cards WHERE origin_detail = 'pokumon';
```

This cascades to annotations (annotations has `ON DELETE CASCADE` on `card_id` FK), which is fine for a fresh import with no annotation rows yet. If annotations exist, back them up first. Orphan `sets` rows whose only members were Pokumon promos (id matching `pokumon-%`) may remain — optionally prune them:

```sql
DELETE FROM sets WHERE id LIKE 'pokumon-%';
```

**Annotation-less rows:** Phase 3 only inserts cards + sets. Annotation rows are created on first edit via `apply_annotation_with_history`. Explore and card detail should tolerate cards with no annotation row. Spot-check a few Pokumon cards render correctly in Explore and detail view before calling this done.

---

## Phase 2: Periodic sync

### Strategy: incremental via `modified_after`

WordPress REST API supports `modified_after` (ISO 8601 with timezone). **The test below is a blocking gate for Phase 2. Do not begin sync implementation until `modified_after` is proven to work for the `card` CPT.**

**Stronger test** (avoid false positives — WordPress might silently ignore unrecognized params and return the full unfiltered list):

```bash
# 1. Get total cards without filter (parse X-WP-Total header from a small GET)
TOTAL=$(curl -sD - -o /dev/null "https://pokumon.com/wp-json/wp/v2/card?per_page=1" | grep -i x-wp-total | tr -d '\r' | awk '{print $2}')
if [ -z "$TOTAL" ]; then
  echo "WARNING: Could not read X-WP-Total header. Try manually:"
  echo "  curl -sI 'https://pokumon.com/wp-json/wp/v2/card?per_page=1'"
fi
echo "Total cards (unfiltered): ${TOTAL:-unknown}"

# 2. Get total with modified_after set to a future date (should be much smaller)
FILTERED=$(curl -sD - -o /dev/null "https://pokumon.com/wp-json/wp/v2/card?per_page=1&modified_after=2027-01-01T00:00:00Z" | grep -i x-wp-total | tr -d '\r' | awk '{print $2}')
if [ -z "$FILTERED" ]; then
  echo "WARNING: Could not read X-WP-Total header for filtered request."
fi
echo "Total after future-date filter: ${FILTERED:-unknown}"

# 3. If both are numeric and FILTERED < TOTAL, modified_after is working.
#    If they're equal or headers are missing, the parameter is likely being ignored.
```

Also verify the response body is a JSON array (not an error object), as a secondary sanity check.

If `modified_after` doesn't work, the fallback is full re-fetch (re-run Phase 1b–1f). At 10k cards this is expensive, hence the requirement to confirm it works before any Phase 2 implementation.

### 2a. Add `--modified-after` to the import script

Modify `import_pokumon_promos.py`:
- Add a `--modified-after` CLI argument (ISO 8601 string, optional)
- When set, pass `modified_after=<value>` as a query param to the WordPress API
- When unset, fetch everything (current behavior)

The `--all`, `--retries`, and `--delay-ms` flags from Phase 1a apply here too.

### 2b. Track sync watermark (via Supabase, not tmp/)

Store the watermark in Supabase, not `tmp/`. The `tmp/` directory is gitignored, local-only, and won't survive machine changes or CI environments.

Query the max `source_modified_gmt` from cards already in Supabase:

```sql
SELECT max(raw_data->>'source_modified_gmt') AS watermark
FROM cards
WHERE origin_detail = 'pokumon';
```

If the result is NULL (no Pokumon cards exist yet, or no rows have the key), the sync script treats this as "no watermark — do a full fetch."

The sync script reads this value via a small Python helper (see 2c), uses it as `--modified-after`, then after a successful run the new max is naturally reflected in the cards table. No separate timestamp file needed.

String `max()` works here because WordPress emits fixed-width ISO 8601 timestamps. If mixed formats ever appear, parse to datetime first.

**Bootstrap:** After Phase 1f completes, the watermark is already in `cards.raw_data->>'source_modified_gmt'`. No extra step needed.

### 2c. Sync run pipeline

Create a lightweight helper script `scripts/pokumon_get_watermark.py` that queries Supabase via PostgREST with `SUPABASE_SERVICE_KEY` from the environment, and prints the newest `source_modified_gmt` (or an empty string if none):

```python
#!/usr/bin/env python3
"""Print max source_modified_gmt for Pokumon cards (empty string if none).
Requires: SUPABASE_URL, SUPABASE_SERVICE_KEY (env vars)."""
import os, sys, httpx

url = os.environ.get("SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_KEY")
if not url or not key:
    print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.", file=sys.stderr)
    sys.exit(1)

r = httpx.get(
    f"{url}/rest/v1/cards",
    headers={"apikey": key, "Authorization": f"Bearer {key}"},
    params={
        "select": "watermark:raw_data->>source_modified_gmt",
        "origin_detail": "eq.pokumon",
        "order": "watermark.desc.nullslast",
        "limit": "1",
    },
    timeout=15,
)
r.raise_for_status()
rows = r.json()
# Explicit alias "watermark:" guarantees the key is "watermark" regardless of PostgREST version.
# Verify once against your Supabase project: if order= on a computed column 400s,
# fall back to fetching rows without order/limit and computing max() in Python.
print((rows[0].get("watermark") or "") if rows else "")
```

**Pipeline script** (`scripts/sync_pokumon.sh` — not intended for interactive pasting):

```bash
#!/bin/bash
set -euo pipefail

# 1. Read current watermark from Supabase
WATERMARK=$(python scripts/pokumon_get_watermark.py)
if [ -z "$WATERMARK" ]; then
  echo "No existing Pokumon cards found — doing full fetch."
  WATERMARK="1970-01-01T00:00:00Z"
else
  # WordPress stored modified_gmt doesn't include a timezone suffix;
  # modified_after may require one. Append Z (UTC) if missing.
  if ! echo "$WATERMARK" | grep -q '[Z+-]'; then
    WATERMARK="${WATERMARK}Z"
  fi
fi
echo "Sync watermark: $WATERMARK"

# 2. Fetch only cards modified since watermark
python scripts/import_pokumon_promos.py \
  --all \
  --modified-after "$WATERMARK" \
  --output tmp/pokumon_sync_preview.json

# 3. Check if any new/updated cards were found
ROW_COUNT=$(python -c "import json; d=json.load(open('tmp/pokumon_sync_preview.json')); print(len(d.get('rows',[])))")

if [ "$ROW_COUNT" -eq 0 ]; then
  echo "No new or updated cards since last sync."
  exit 0
fi

# 4. Analyze + generate staging SQL
python scripts/analyze_pokumon_pilot.py \
  --input tmp/pokumon_sync_preview.json \
  --output-json tmp/pokumon_sync_analysis.json \
  --output-md tmp/pokumon_sync_analysis.md
python scripts/generate_pokumon_staging_sql.py \
  --chunk-size 2000 \
  --input tmp/pokumon_sync_preview.json \
  --output tmp/pokumon_sync_load.sql

echo "Generated staging SQL: tmp/pokumon_sync_load.sql"
echo "Next: run in Supabase SQL Editor, then run preflight + phase 3 insert."
```

`--all` here means "fetch all matching pages," not "every card in existence." When combined with `--modified-after`, it paginates through all filtered results.

### 2d. Scheduling

- **Manual (start here):** Monthly calendar reminder. Run `bash scripts/sync_pokumon.sh`, then follow the manual SQL steps.
- **CI workflow (future):** Add `.github/workflows/sync-pokumon.yml` on a cron schedule. Since the watermark lives in Supabase (not `tmp/`), it survives CI ephemeral runners. The Phase 3 insert should remain manual until confidence is high.

---

## Risks (explicit non-goals)

### Deleted cards are not handled

`modified_after` won't return cards that were deleted from Pokumon since the last sync. If Pokumon removes a card, the Supabase copy stays. Over time, this drift accumulates orphaned rows. If deletion tracking matters later, a full comparison (all Pokumon source IDs vs. Supabase IDs with `origin_detail='pokumon'`) is needed to find and flag removed cards.

### Image URLs are hot-linked

All 10k+ cards store direct URLs to Pokumon's WordPress media library. If Pokumon restructures their permalink structure, changes CDNs, or installs an image optimization plugin that rewrites URLs, stored `image_url` values break at scale. A mass re-import or URL mapping would be needed. For long-term stability, consider whether mirroring images to Supabase Storage is worth the storage cost — deferred, not scoped here.

---

## Phase 3: Cleanup (optional, post-import)

### 3a. Staging table: keep as standalone script

`staging_pokumon_cards` was created ad-hoc via `pokumon_staging_review.sql`. Keep it as a standalone script rather than a formal migration — it's an import utility table, not application schema. Supabase CLI `db push` requires strictly sequential migration numbering, and this table doesn't need to be part of the schema migration chain. If a new environment needs it, run `pokumon_staging_review.sql` manually.

### 3b. `last_seen_in_api` / staleness

Pokumon cards are `origin='manual'` so they bypass the `last_seen_in_api` staleness tracking used by pokemontcg.io cards. If staleness for Pokumon matters later, a separate signal (e.g. bumping a field in `raw_data` or a dedicated metadata table) would be needed. Not in scope now.

### 3c. DuckDB / v1 parity

Pokumon cards are Supabase-only (`origin='manual'`). If anyone still relies on DuckDB-WASM (v1/Pages), these cards won't appear there. No action needed unless that's a requirement.

---

## Files touched

| File | Change |
|------|--------|
| `scripts/import_pokumon_promos.py` | Add `--all`, `--modified-after`, `--retries N` (mandatory for `--all`), `--delay-ms` |
| `scripts/generate_pokumon_staging_sql.py` | Add `--chunk-size 2000` default; inject batch label into generated SQL |
| `scripts/pokumon_phase3_pilot_insert.sql` | Replace hardcoded batch label with `vars` CTE or placeholder; add `created_by = NULL` in INSERT + DO UPDATE; fix footer query |
| `scripts/pokumon_get_watermark.py` | **New:** queries Supabase for max `source_modified_gmt` |
| `scripts/sync_pokumon.sh` | **New:** end-to-end sync pipeline script |
| `docs/plans/pokumon-full-import-and-sync.md` | This plan |

No app code changes. No new migration required.

---

## Verification

- [ ] `modified_after` confirmed working for `card` CPT via the X-WP-Total comparison test (blocking gate — do not start Phase 2 until this passes)
- [ ] Phase 1f: `SELECT count(*) FROM cards WHERE origin_detail = 'pokumon'` returns ~10,813
- [ ] Phase 1f: `SELECT count(*) FROM cards WHERE origin_detail = 'pokumon' AND created_by IS NOT NULL` returns 0
- [ ] Spot-check: 5–10 Pokumon cards render correctly in Explore grid and Card detail
- [ ] Rollback tested: running the DELETE statement removes all Pokumon cards cleanly
- [ ] Phase 2c (DB path): After updating 1 staging row's `raw_modified_gmt` to a future date and re-running sync, that card is refreshed in `cards`
- [ ] Phase 2c (WP path, if `modified_after` confirmed): After a known card is updated on pokumon.com, incremental fetch returns only changed posts
- [ ] `npm run check:quick` passes
