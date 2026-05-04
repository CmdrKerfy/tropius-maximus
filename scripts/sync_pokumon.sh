#!/bin/bash
set -euo pipefail

# Ensure we're in the repo root (scripts use relative paths)
cd "$(dirname "$0")/.."

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
