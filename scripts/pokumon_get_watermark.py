#!/usr/bin/env python3
"""Print max source_modified_gmt for Pokumon cards (empty string if none).

Requires: SUPABASE_URL, SUPABASE_SERVICE_KEY (env vars).

Uses a direct PostgREST table query (no RPC needed).
"""
import os
import sys

import httpx


def main() -> int:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.", file=sys.stderr)
        return 1

    try:
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
        # Explicit alias "watermark:" guarantees the key is "watermark".
        # Verify once against your Supabase project: if order= on a computed
        # column 400s, fall back to fetching rows without order/limit and
        # computing max() in Python.
        if rows:
            print(rows[0].get("watermark") or "")
        else:
            print("")
    except Exception as exc:
        print(f"ERROR querying watermark: {exc}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
