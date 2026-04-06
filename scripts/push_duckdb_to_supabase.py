#!/usr/bin/env python3
"""
Push API-sourced rows from the ingest DuckDB file into Supabase.

Reads the same database as ``scripts/ingest.py`` (default: ``public/data/pokemon.duckdb``).
Upserts ``sets``, ``cards`` (origins ``pokemontcg.io`` and ``tcgdex`` only), and
``pokemon_metadata``. Rows with ``is_custom`` in DuckDB are skipped. Does not touch
``origin = manual`` cards in Postgres unless their IDs collide with API IDs (same as a
normal upsert by primary key).

Environment (same as ``migrate_data.py``):

  SUPABASE_URL          https://xxx.supabase.co
  SUPABASE_SERVICE_KEY  service_role JWT or sb_secret_... (never commit)

Usage::

  python scripts/push_duckdb_to_supabase.py [--dry-run] [--duckdb PATH]

Optional: run after ``python scripts/ingest.py`` or use ``ingest.py --push-supabase``.
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import duckdb

try:
    from postgrest import SyncPostgrestClient
except ImportError:
    print("Install dependencies: pip install -r scripts/requirements-ci.txt", file=sys.stderr)
    sys.exit(1)

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_DUCKDB = SCRIPT_DIR.parent / "public" / "data" / "pokemon.duckdb"
BATCH_SIZE = 500
DRY_RUN = "--dry-run" in sys.argv


def create_rest_client(url: str, key: str) -> SyncPostgrestClient:
    base = url.rstrip("/")
    if not base.startswith("http://") and not base.startswith("https://"):
        raise SystemExit(f"SUPABASE_URL must start with http(s)://, got: {url!r}")
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    return SyncPostgrestClient(f"{base}/rest/v1", headers=headers)


def coerce_int(val):
    if val is None or val == "":
        return None
    try:
        return int(val)
    except (ValueError, TypeError):
        return None


def parse_json_col(val, default=None):
    if val is None:
        return default
    if isinstance(val, (dict, list)):
        return val
    if isinstance(val, str):
        s = val.strip()
        if not s:
            return default
        try:
            return json.loads(s)
        except (json.JSONDecodeError, ValueError):
            return default
    return default


def clean_date(val) -> str | None:
    if val is None:
        return None
    s = str(val).strip()
    if not s:
        return None
    return s[:10]


def batch_upsert(sb, table: str, rows: list) -> int:
    if not rows:
        return 0
    total = 0
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        if DRY_RUN:
            total += len(batch)
            continue
        sb.table(table).upsert(batch).execute()
        total += len(batch)
    return total


def fetch_dicts(conn: duckdb.DuckDBPyConnection, sql: str) -> list[dict]:
    cur = conn.execute(sql)
    names = [c[0] for c in cur.description]
    return [dict(zip(names, row)) for row in cur.fetchall()]


def push_sets(conn, sb) -> tuple[int, int]:
    tcg = fetch_dicts(conn, "SELECT * FROM sets")
    rows = []
    for s in tcg:
        rows.append(
            {
                "id": s["id"],
                "name": s.get("name") or s["id"],
                "series": s.get("series") or None,
                "printed_total": coerce_int(s.get("printed_total")),
                "total": coerce_int(s.get("total")),
                "release_date": clean_date(s.get("release_date")),
                "symbol_url": s.get("symbol_url") or None,
                "logo_url": s.get("logo_url") or None,
                "origin": "pokemontcg.io",
            }
        )
    n_tcg = batch_upsert(sb, "sets", rows)

    pocket = fetch_dicts(conn, "SELECT * FROM pocket_sets")
    rows = []
    for s in pocket:
        rows.append(
            {
                "id": s["id"],
                "name": s.get("name") or s["id"],
                "series": s.get("series") or None,
                "release_date": clean_date(s.get("release_date")),
                "card_count": coerce_int(s.get("card_count")),
                "packs": parse_json_col(s.get("packs"), []) or [],
                "logo_url": s.get("logo_url") or None,
                "origin": "tcgdex",
            }
        )
    n_pocket = batch_upsert(sb, "sets", rows)
    return n_tcg, n_pocket


def push_pokemon_metadata(conn, sb) -> int:
    rows = []
    for m in fetch_dicts(conn, "SELECT * FROM pokemon_metadata"):
        rows.append(
            {
                "pokedex_number": int(m["pokedex_number"]),
                "name": m.get("name") or None,
                "region": m.get("region") or None,
                "generation": coerce_int(m.get("generation")),
                "color": m.get("color") or None,
                "shape": m.get("shape") or None,
                "genus": m.get("genus") or None,
                "encounter_location": m.get("encounter_location") or None,
                "evolution_chain": parse_json_col(m.get("evolution_chain"), []),
            }
        )
    return batch_upsert(sb, "pokemon_metadata", rows)


def push_tcg_cards(conn, sb, now_iso: str) -> int:
    sql = """
        SELECT * FROM tcg_cards
        WHERE COALESCE(is_custom, FALSE) = FALSE
    """
    rows_out = []
    for c in fetch_dicts(conn, sql):
        rows_out.append(
            {
                "id": c["id"],
                "name": c.get("name") or "Unknown",
                "supertype": c.get("supertype") or None,
                "subtypes": parse_json_col(c.get("subtypes"), []) or [],
                "hp": c.get("hp") if c.get("hp") not in (None, "") else None,
                "types": parse_json_col(c.get("types"), []) or [],
                "evolves_from": c.get("evolves_from") or None,
                "rarity": c.get("rarity") or None,
                "artist": c.get("artist") or None,
                "set_id": c.get("set_id") or None,
                "number": str(c.get("number") or "") or None,
                "set_name": c.get("set_name") or None,
                "set_series": c.get("set_series") or None,
                "regulation_mark": c.get("regulation_mark") or None,
                "image_small": c.get("image_small") or None,
                "image_large": c.get("image_large") or None,
                "raw_data": parse_json_col(c.get("raw_data"), {}) or {},
                "prices": parse_json_col(c.get("prices"), {}) or {},
                "origin": "pokemontcg.io",
                "format": "printed",
                "last_seen_in_api": now_iso,
            }
        )
    return batch_upsert(sb, "cards", rows_out)


def push_pocket_cards(conn, sb, now_iso: str) -> int:
    sql = """
        SELECT * FROM pocket_cards
        WHERE COALESCE(is_custom, FALSE) = FALSE
    """
    rows_out = []
    for c in fetch_dicts(conn, sql):
        num = c.get("number")
        num_str = str(int(num)) if num is not None else None
        ill = c.get("illustrator") or None
        rows_out.append(
            {
                "id": c["id"],
                "name": c.get("name") or "Unknown",
                "card_type": c.get("card_type") or None,
                "rarity": c.get("rarity") or None,
                "artist": ill,
                "illustrator": ill,
                "set_id": c.get("set_id") or None,
                "number": num_str,
                "element": c.get("element") or None,
                "hp": str(c["hp"]) if c.get("hp") is not None else None,
                "stage": c.get("stage") or None,
                "retreat_cost": coerce_int(c.get("retreat_cost")),
                "weakness": c.get("weakness") or None,
                "evolves_from": c.get("evolves_from") or None,
                "packs": parse_json_col(c.get("packs")),
                "image_small": c.get("image_url") or None,
                "image_large": c.get("image_url") or None,
                "raw_data": parse_json_col(c.get("raw_data"), {}) or {},
                "origin": "tcgdex",
                "format": "digital",
                "last_seen_in_api": now_iso,
            }
        )
    return batch_upsert(sb, "cards", rows_out)


def main() -> None:
    duck_path = DEFAULT_DUCKDB
    if "--duckdb" in sys.argv:
        i = sys.argv.index("--duckdb")
        if i + 1 >= len(sys.argv):
            print("--duckdb requires a path", file=sys.stderr)
            sys.exit(2)
        duck_path = Path(sys.argv[i + 1])

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not DRY_RUN and (not url or not key):
        print("Set SUPABASE_URL and SUPABASE_SERVICE_KEY (same as migrate_data.py).", file=sys.stderr)
        sys.exit(1)

    if not duck_path.is_file():
        print(f"DuckDB file not found: {duck_path}", file=sys.stderr)
        print("Run scripts/ingest.py first.", file=sys.stderr)
        sys.exit(1)

    now_iso = datetime.now(timezone.utc).isoformat()
    sb = create_rest_client(url, key) if not DRY_RUN else None

    print(f"DuckDB: {duck_path}")
    if DRY_RUN:
        print("=== DRY RUN — no writes to Supabase ===")

    conn = duckdb.connect(str(duck_path), read_only=True)
    try:
        n_tcg_sets, n_pocket_sets = push_sets(conn, sb)
        print(f"  sets (TCG): {n_tcg_sets} rows")
        print(f"  sets (Pocket): {n_pocket_sets} rows")

        n_meta = push_pokemon_metadata(conn, sb)
        print(f"  pokemon_metadata: {n_meta} rows")

        n_tcg = push_tcg_cards(conn, sb, now_iso)
        print(f"  cards (pokemontcg.io): {n_tcg} rows")

        n_pocket = push_pocket_cards(conn, sb, now_iso)
        print(f"  cards (tcgdex): {n_pocket} rows")
    finally:
        conn.close()

    print("Done.")


if __name__ == "__main__":
    main()
