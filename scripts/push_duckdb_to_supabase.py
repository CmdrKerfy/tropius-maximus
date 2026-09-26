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
  SUPABASE_SERVICE_KEY  **service_role** secret from Supabase → Settings → API (never commit).
  Do **not** use the ``anon`` / ``publishable`` key — PostgREST will hit RLS and upserts fail with
  ``42501 new row violates row-level security policy``.

Usage::

  python scripts/push_duckdb_to_supabase.py [--dry-run] [--duckdb PATH]

Optional: run after ``python scripts/ingest.py`` or use ``ingest.py --push-supabase``.
"""

from __future__ import annotations

import base64
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import duckdb

try:
    from postgrest import SyncPostgrestClient
    from postgrest.types import ReturnMethod
except ImportError:
    print("Install dependencies: pip install -r scripts/requirements-ci.txt", file=sys.stderr)
    sys.exit(1)

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_DUCKDB = SCRIPT_DIR.parent / "public" / "data" / "pokemon.duckdb"
# Card rows contain sizeable JSON payloads. A 500-row upsert can exceed the
# statement timeout on Supabase's nano compute, especially just after resume.
BATCH_SIZE = 100
MIN_BATCH_SIZE = 10
DRY_RUN = "--dry-run" in sys.argv
import time


def exit_if_jwt_is_anon_key(key: str) -> None:
    """PostgREST bypasses RLS only with the service_role JWT; anon key triggers 42501 on writes."""
    if not key or not key.startswith("eyJ"):
        return
    parts = key.split(".")
    if len(parts) != 3:
        return
    try:
        payload = parts[1]
        pad = (4 - len(payload) % 4) % 4
        if pad:
            payload += "=" * pad
        data = json.loads(base64.urlsafe_b64decode(payload))
        if data.get("role") == "anon":
            print(
                "ERROR: SUPABASE_SERVICE_KEY is the anon (publishable) JWT.\n"
                "Use the service_role secret from Supabase → Project Settings → API.\n"
                "The anon key cannot bypass RLS; upserts will fail with policy violations.",
                file=sys.stderr,
            )
            sys.exit(1)
    except (ValueError, json.JSONDecodeError, IndexError):
        return


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
    """Upsert every row, shrinking the remaining batches after a timeout.

    Keep the reduced size for subsequent requests. The previous retry loop
    repeatedly sent the first slice of a failed batch and could skip its tail.
    """
    if not rows:
        return 0
    total = 0
    i = 0
    effective_batch_size = BATCH_SIZE
    while i < len(rows):
        size = min(effective_batch_size, len(rows) - i)
        if DRY_RUN:
            total += size
            i += size
            continue
        while True:
            batch = rows[i : i + size]
            try:
                sb.table(table).upsert(
                    batch,
                    returning=ReturnMethod.minimal,
                ).execute()
                break
            except Exception as exc:
                message = str(exc).lower()
                is_statement_timeout = "57014" in message or "statement timeout" in message
                if not is_statement_timeout or size <= MIN_BATCH_SIZE:
                    raise
                size = max(MIN_BATCH_SIZE, size // 2)
                effective_batch_size = size
                print(f"  ({table} statement timeout; retrying with {size}-row batches)", flush=True)
                time.sleep(1)
        total += size
        i += size
    return total


# Post-push maintenance RPCs. These need the service_role timeout budget from
# migration 20260926092111; without it PostgREST applies authenticator's 8 s
# limit and the ~12+ s view refresh fails deterministically with 57014.
MAINTENANCE_MAX_ATTEMPTS = 3
MAINTENANCE_BACKOFF_SECONDS = (5, 15)
# Postgres SQLSTATEs (and PostgREST connection codes) worth retrying:
# statement/lock timeouts, connection failures, server restarts.
TRANSIENT_SQLSTATE_PREFIXES = ("08", "57P0")
TRANSIENT_CODES = {"57014", "55P03", "PGRST000", "PGRST001", "PGRST002", "PGRST003"}
TRANSIENT_MESSAGE_MARKERS = (
    "statement timeout",
    "lock timeout",
    "connection reset",
    "connection refused",
    "server disconnected",
    "remote end closed",
)


class MaintenanceRpcError(RuntimeError):
    """A post-push maintenance RPC failed after all allowed attempts."""

    def __init__(self, function_name: str, attempts: int, reason: str):
        super().__init__(f"{function_name} failed after {attempts} attempt(s): {reason}")
        self.function_name = function_name
        self.attempts = attempts
        self.reason = reason


def _error_code(exc: BaseException) -> str:
    code = getattr(exc, "code", None)
    return "" if code is None else str(code).strip()


def describe_maintenance_error(exc: BaseException) -> str:
    """Short, secret-free reason: exception type, code, and a truncated message.

    The service key only travels in request headers, which are never included.
    """
    message = getattr(exc, "message", None) or str(exc)
    message = " ".join(str(message).split())[:200]
    code = _error_code(exc)
    prefix = f"{type(exc).__name__}"
    if code:
        prefix += f" {code}"
    return f"{prefix}: {message}" if message else prefix


def is_transient_maintenance_error(exc: BaseException) -> bool:
    """True for timeouts, dropped connections, and 5xx responses."""
    if isinstance(exc, (ConnectionError, TimeoutError)):
        return True
    try:
        import httpx

        if isinstance(exc, httpx.TransportError):
            return True
    except ImportError:  # pragma: no cover - httpx ships with postgrest
        pass

    code = _error_code(exc)
    if code in TRANSIENT_CODES or code.startswith(TRANSIENT_SQLSTATE_PREFIXES):
        return True
    # Non-JSON gateway responses surface the HTTP status as the code.
    if code.isdigit() and 500 <= int(code) <= 599:
        return True
    message = str(getattr(exc, "message", None) or exc).lower()
    return any(marker in message for marker in TRANSIENT_MESSAGE_MARKERS)


def call_maintenance_rpc(sb, function_name: str) -> tuple[int, float]:
    """Call a zero-argument maintenance RPC with bounded retry/backoff.

    Returns (attempts, seconds for the successful call). Raises
    MaintenanceRpcError immediately for non-transient errors, or after
    MAINTENANCE_MAX_ATTEMPTS transient failures.
    """
    for attempt in range(1, MAINTENANCE_MAX_ATTEMPTS + 1):
        started = time.monotonic()
        try:
            # postgrest-py 0.x requires params even for a zero-argument function.
            sb.rpc(function_name, {}).execute()
            return attempt, time.monotonic() - started
        except Exception as exc:
            reason = describe_maintenance_error(exc)
            elapsed = time.monotonic() - started
            if not is_transient_maintenance_error(exc):
                raise MaintenanceRpcError(function_name, attempt, f"non-retryable: {reason}") from exc
            if attempt >= MAINTENANCE_MAX_ATTEMPTS:
                raise MaintenanceRpcError(function_name, attempt, reason) from exc
            delay = MAINTENANCE_BACKOFF_SECONDS[
                min(attempt - 1, len(MAINTENANCE_BACKOFF_SECONDS) - 1)
            ]
            print(
                f"  {function_name}: attempt {attempt}/{MAINTENANCE_MAX_ATTEMPTS} failed after "
                f"{elapsed:.1f}s ({reason}); retrying in {delay}s",
                flush=True,
            )
            time.sleep(delay)
    raise AssertionError("unreachable")  # pragma: no cover


def refresh_post_push_data(sb) -> tuple[bool, bool]:
    """Refresh derived Explore data and planner statistics after upserts.

    A failed view refresh is fatal (raises MaintenanceRpcError) so a stale
    filter view cannot produce a green ingest run. A failed ANALYZE stays
    nonfatal but is reported as a GitHub Actions warning with structured
    details.
    """
    try:
        attempts, seconds = call_maintenance_rpc(sb, "refresh_explore_filter_options")
    except MaintenanceRpcError as exc:
        details = json.dumps(
            {
                "step": exc.function_name,
                "status": "failed",
                "attempts": exc.attempts,
                "final_reason": exc.reason,
            }
        )
        print(f"::error title=Explore filter refresh failed::{details}", flush=True)
        raise
    print(f"  explore_filter_options: refreshed in {seconds:.1f}s (attempts: {attempts})")

    stats_refreshed = False
    try:
        attempts, seconds = call_maintenance_rpc(sb, "analyze_cards_and_annotations")
        print(f"  analyze: cards + annotations statistics refreshed in {seconds:.1f}s (attempts: {attempts})")
        stats_refreshed = True
    except MaintenanceRpcError as exc:
        details = json.dumps(
            {
                "step": exc.function_name,
                "status": "failed_nonfatal",
                "attempts": exc.attempts,
                "final_reason": exc.reason,
            }
        )
        print(f"::warning title=ANALYZE failed (nonfatal)::{details}", flush=True)
        print("  analyze: FAILED — planner statistics may be stale until the next ANALYZE")

    return True, stats_refreshed


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


def push_japanese_cards(conn, sb, now_iso: str) -> int:
    sql = """
        SELECT * FROM japanese_cards
        WHERE COALESCE(is_custom, FALSE) = FALSE
    """
    # Build a set_id -> set_name lookup from japanese_sets
    set_names = {}
    for s in fetch_dicts(conn, "SELECT id, name FROM japanese_sets"):
        if s.get("id"):
            set_names[s["id"]] = s.get("name") or s["id"]

    rows_out = []
    for c in fetch_dicts(conn, sql):
        num = c.get("number")
        num_str = str(int(num)) if num is not None else None
        ill = c.get("illustrator") or None
        sid = c.get("set_id") or None
        rows_out.append(
            {
                "id": c["id"],
                "name": c.get("name") or "Unknown",
                "card_type": c.get("card_type") or None,
                "rarity": c.get("rarity") or None,
                "artist": ill,
                "illustrator": ill,
                "set_id": sid,
                "set_name": set_names.get(sid) if sid else None,
                "number": num_str,
                "element": c.get("element") or None,
                "hp": str(c["hp"]) if c.get("hp") is not None else None,
                "stage": c.get("stage") or None,
                "retreat_cost": coerce_int(c.get("retreat_cost")),
                "weakness": c.get("weakness") or None,
                "evolves_from": c.get("evolves_from") or None,
                "image_small": c.get("image_url") or None,
                "image_large": c.get("image_url") or None,
                "raw_data": parse_json_col(c.get("raw_data"), {}) or {},
                "origin": "tcgdex",
                "origin_detail": "japanese",
                "format": "printed",
                "last_seen_in_api": now_iso,
            }
        )
    return batch_upsert(sb, "cards", rows_out)


def push_ptcgdb_sets(conn, sb) -> int:
    """Upsert sets referenced by PTCG-database Japanese cards."""
    sql = "SELECT DISTINCT set_id FROM japanese_cards_ptcgdb WHERE is_custom IS NOT TRUE"
    rows = []
    for r in fetch_dicts(conn, sql):
        sid = r.get("set_id")
        if not sid:
            continue
        rows.append(
            {
                "id": sid,
                "name": sid.upper(),
                "origin": "ptcgdb",
            }
        )
    if rows:
        return batch_upsert(sb, "sets", rows)
    return 0


def push_japanese_cards_ptcgdb(conn, sb, now_iso: str) -> int:
    """Push PTCG-database Japanese cards (ptcgdb- prefix IDs) to Supabase."""
    sql = """
        SELECT * FROM japanese_cards_ptcgdb
        WHERE COALESCE(is_custom, FALSE) = FALSE
    """
    rows_out = []
    for c in fetch_dicts(conn, sql):
        hp_val = c.get("hp")
        types_val = parse_json_col(c.get("types"), []) or []
        subtypes_val = parse_json_col(c.get("subtypes"), []) or []
        rows_out.append(
            {
                "id": c["id"],
                "name": c.get("name") or "Unknown",
                "card_type": c.get("card_type") or None,
                "rarity": c.get("rarity") or None,
                "artist": c.get("illustrator") or None,
                "illustrator": c.get("illustrator") or None,
                "set_id": c.get("set_id") or None,
                "number": str(c.get("number") or ""),
                "element": c.get("element") or None,
                "types": types_val if types_val else [],
                "subtypes": subtypes_val if subtypes_val else [],
                "hp": str(hp_val) if hp_val not in (None, "", "None") else None,
                "stage": c.get("stage") or None,
                "retreat_cost": coerce_int(c.get("retreat_cost")),
                "weakness": c.get("weakness") or None,
                "evolves_from": c.get("evolves_from") or None,
                "image_small": c.get("image_small") or None,
                "image_large": c.get("image_large") or None,
                "raw_data": parse_json_col(c.get("raw_data"), {}) or {},
                "origin": "ptcgdb",
                "origin_detail": "japanese",
                "format": "printed",
                "last_seen_in_api": now_iso,
            }
        )
    return batch_upsert(sb, "cards", rows_out)


def push_japanese_sets(conn, sb) -> int:
    rows = []
    for s in fetch_dicts(conn, "SELECT * FROM japanese_sets"):
        rows.append(
            {
                "id": s["id"],
                "name": s.get("name") or s["id"],
                "series": s.get("series") or None,
                "release_date": clean_date(s.get("release_date")),
                "card_count": coerce_int(s.get("card_count")),
                "logo_url": s.get("logo_url") or None,
                "origin": "tcgdex",
            }
        )
    return batch_upsert(sb, "sets", rows)


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
    if not DRY_RUN and key:
        exit_if_jwt_is_anon_key(key)

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

        n_japanese_sets = push_japanese_sets(conn, sb)
        print(f"  sets (Japanese): {n_japanese_sets} rows")

        n_meta = push_pokemon_metadata(conn, sb)
        print(f"  pokemon_metadata: {n_meta} rows")

        n_tcg = push_tcg_cards(conn, sb, now_iso)
        print(f"  cards (pokemontcg.io): {n_tcg} rows")

        n_pocket = push_pocket_cards(conn, sb, now_iso)
        print(f"  cards (tcgdex Pocket): {n_pocket} rows")

        n_japanese = push_japanese_cards(conn, sb, now_iso)
        print(f"  cards (tcgdex Japanese): {n_japanese} rows")

        # PTCG-database Japanese cards (optional table — skip if not present)
        tables = {row[0] for row in conn.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='main'").fetchall()}
        if "japanese_cards_ptcgdb" in tables:
            n_jp_ptcgdb_sets = push_ptcgdb_sets(conn, sb)
            if n_jp_ptcgdb_sets:
                print(f"  sets (PTCG-db): {n_jp_ptcgdb_sets} rows")
            n_jp_ptcgdb = push_japanese_cards_ptcgdb(conn, sb, now_iso)
            print(f"  cards (PTCG-db Japanese): {n_jp_ptcgdb} rows")
    finally:
        conn.close()

    # Refresh the Explore filter options materialized view and planner stats.
    if not DRY_RUN and sb:
        refresh_post_push_data(sb)

    print("Done.")


if __name__ == "__main__":
    main()
