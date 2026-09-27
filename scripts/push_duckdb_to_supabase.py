#!/usr/bin/env python3
"""
Push API-sourced rows from the ingest DuckDB file into Supabase.

Reads the same database as ``scripts/ingest.py`` (default: ``public/data/pokemon.duckdb``).
Upserts ``sets``, ``cards`` (origins ``pokemontcg.io`` and ``tcgdex``; ``ptcgdb`` only with
``--include-ptcgdb``), and ``pokemon_metadata``. Rows with ``is_custom`` in DuckDB are skipped.

A card or set whose ID already belongs to another origin in Postgres (for example a
``manual`` card) is never overwritten: it is skipped and reported as an ID collision.
Cards whose content fingerprint (``cards.api_hash``) is unchanged are skipped, so a run
without upstream changes writes almost nothing; ``last_seen_in_api`` is therefore only
stamped on rows that were published. TCGdex Japanese sets whose upstream ID is also an
English set ID (``neo1``–``neo4``) are published as ``ja-<id>`` (cards ``ja-<card id>``).

Environment (same as ``migrate_data.py``):

  SUPABASE_URL          https://xxx.supabase.co
  SUPABASE_SERVICE_KEY  **service_role** secret from Supabase → Settings → API (never commit).
  Do **not** use the ``anon`` / ``publishable`` key — PostgREST will hit RLS and upserts fail with
  ``42501 new row violates row-level security policy``.

Usage::

  python scripts/push_duckdb_to_supabase.py [--dry-run] [--duckdb PATH] [--include-ptcgdb]

PTCG-database Japanese cards (``japanese_cards_ptcgdb``) are skipped unless
``--include-ptcgdb`` is passed, so cached staging rows cannot silently recreate
cross-source duplicates on a scheduled run.

TCGdex Japanese cards whose PTCG-db twin (same set and normalized number) is already
published are skipped: PTCG-db is the preferred Japanese source, and upserting the
TCGdex copy would recreate the duplicate removed by the May 2026 dedup.

Optional: run after ``python scripts/ingest.py`` or use ``ingest.py --push-supabase``.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import duckdb

from jpn_card_key_utils import _normalize_jpn_number

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
INCLUDE_PTCGDB = "--include-ptcgdb" in sys.argv
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


# Publication gate: what Supabase already holds, read once per push.
EXISTING_PAGE_SIZE = 1000
API_HASH_EXCLUDED_KEYS = ("last_seen_in_api", "api_hash")
COLLISION_IDS_IN_SUMMARY = 20


def api_hash(row: dict) -> str:
    """SHA-256 of a published payload, ignoring the per-run observation stamp."""
    payload = {k: v for k, v in row.items() if k not in API_HASH_EXCLUDED_KEYS}
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


class PublishGate:
    """Supabase's card/set ownership and card fingerprints for this push.

    A row whose ID already belongs to another origin (a manual card, or
    another source's row) is skipped and reported, never overwritten. With
    ``hashes`` (the ``cards.api_hash`` column exists), cards whose fingerprint
    is unchanged are skipped, so a push without upstream changes writes almost
    nothing. An empty gate (dry run) publishes everything.

    Rows published in this run claim their IDs, so a later source in the same
    push cannot overwrite them either.
    """

    def __init__(self, cards: dict | None = None, sets: dict | None = None, hashes: bool = False):
        self.cards = dict(cards or {})  # id -> (origin, api_hash or None)
        self.sets = dict(sets or {})  # id -> origin
        self.hashes = hashes
        self.collisions: dict[str, list[str]] = {}
        self.unchanged: dict[str, int] = {}

    def ids_with_origin(self, origin: str) -> set[str]:
        return {card_id for card_id, (o, _) in self.cards.items() if o == origin}

    def _collide(self, label: str, row_id: str) -> None:
        self.collisions.setdefault(label, []).append(row_id)

    def filter_cards(self, label: str, rows: list[dict]) -> list[dict]:
        out = []
        for row in rows:
            existing = self.cards.get(row["id"])
            if existing and existing[0] != row["origin"]:
                self._collide(label, row["id"])
                continue
            digest = api_hash(row)
            if self.hashes and existing and existing[1] == digest:
                self.unchanged[label] = self.unchanged.get(label, 0) + 1
                continue
            self.cards[row["id"]] = (row["origin"], digest)
            out.append({**row, "api_hash": digest} if self.hashes else row)
        return out

    def filter_sets(self, label: str, rows: list[dict]) -> list[dict]:
        out = []
        for row in rows:
            existing = self.sets.get(row["id"])
            if existing and existing != row["origin"]:
                self._collide(label, row["id"])
                continue
            self.sets[row["id"]] = row["origin"]
            out.append(row)
        return out


def fetch_all_rows(sb, table: str, columns: str) -> list[dict]:
    """Every row of ``table`` (selected ``columns``), keyset-paged on ``id``."""
    rows: list[dict] = []
    last = None
    while True:
        query = sb.table(table).select(columns)
        if last is not None:
            query = query.gt("id", last)
        page = query.order("id").limit(EXISTING_PAGE_SIZE).execute().data
        rows.extend(page)
        if len(page) < EXISTING_PAGE_SIZE:
            return rows
        last = page[-1]["id"]


def _is_missing_api_hash_column(exc: BaseException) -> bool:
    message = str(getattr(exc, "message", None) or exc)
    return _error_code(exc) in {"42703", "PGRST204"} and "api_hash" in message


def fetch_publish_gate(sb) -> PublishGate:
    """Read card/set ownership (and card fingerprints when available)."""
    if sb is None:
        print("  (dry run: ID collisions and unchanged rows not checked; every row counts as published)")
        return PublishGate()
    try:
        cards = fetch_all_rows(sb, "cards", "id,origin,api_hash")
        hashes = True
    except Exception as exc:
        if not _is_missing_api_hash_column(exc):
            raise
        print(
            "  (cards.api_hash not found — migration 20260926220844 not applied; "
            "publishing every row without fingerprints)",
            flush=True,
        )
        cards = fetch_all_rows(sb, "cards", "id,origin")
        hashes = False
    sets = fetch_all_rows(sb, "sets", "id,origin")
    print(f"  existing: {len(cards)} cards, {len(sets)} sets (fingerprints: {'on' if hashes else 'off'})")
    return PublishGate(
        {r["id"]: (r["origin"], r.get("api_hash")) for r in cards},
        {r["id"]: r["origin"] for r in sets},
        hashes,
    )


def publish(sb, gate: PublishGate, table: str, label: str, rows: list[dict]) -> int:
    """Upsert the rows the gate lets through; returns how many were written."""
    if table == "cards":
        rows = gate.filter_cards(label, rows)
    else:
        rows = gate.filter_sets(label, rows)
    return batch_upsert(sb, table, rows)


# Post-push maintenance RPCs. These need the service_role timeout budget from
# migration 20260926092111; without it PostgREST applies authenticator's 8 s
# limit and the ~12+ s view refresh fails deterministically with 57014.
# Right after a full upsert the database is I/O-bound for a few minutes (the
# checkpoint flushes the rewritten pages, and the first scan of each rewritten
# page sets hint bits, which with data checksums writes full-page images): in run
# 36273193023 two refresh attempts hit the 60 s limit while that checkpoint ran,
# and the next attempt took 16.5 s. The retry window must outlast one
# checkpoint cycle (checkpoint_timeout 300 s), not just a network blip.
MAINTENANCE_MAX_ATTEMPTS = 5
MAINTENANCE_BACKOFF_SECONDS = (15, 30, 60, 120)
MAINTENANCE_STATEMENT_TIMEOUT_SECONDS = 60  # service_role statement_timeout
POST_UPSERT_IO_WINDOW_SECONDS = 300  # checkpoint_timeout on the project
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


def refresh_post_push_data(sb, report: dict | None = None) -> tuple[bool, bool]:
    """Refresh derived Explore data and planner statistics after upserts.

    A failed view refresh is fatal (raises MaintenanceRpcError) so a stale
    filter view cannot produce a green ingest run. A failed ANALYZE stays
    nonfatal but is reported as a GitHub Actions warning with structured
    details. When ``report`` is given, each step's outcome is recorded in it
    under the RPC name for the step summary.
    """
    if report is None:
        report = {}
    try:
        attempts, seconds = call_maintenance_rpc(sb, "refresh_explore_filter_options")
    except MaintenanceRpcError as exc:
        report[exc.function_name] = {"status": "failed", "attempts": exc.attempts, "reason": exc.reason}
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
    report["refresh_explore_filter_options"] = {"status": "ok", "attempts": attempts, "seconds": seconds}
    print(f"  explore_filter_options: refreshed in {seconds:.1f}s (attempts: {attempts})")

    stats_refreshed = False
    try:
        attempts, seconds = call_maintenance_rpc(sb, "analyze_cards_and_annotations")
        print(f"  analyze: cards + annotations statistics refreshed in {seconds:.1f}s (attempts: {attempts})")
        report["analyze_cards_and_annotations"] = {"status": "ok", "attempts": attempts, "seconds": seconds}
        stats_refreshed = True
    except MaintenanceRpcError as exc:
        report[exc.function_name] = {"status": "failed (nonfatal)", "attempts": exc.attempts, "reason": exc.reason}
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


EDIT_HISTORY_QUARTERS_AHEAD = 4
EDIT_HISTORY_MIN_FUTURE_QUARTERS = 2


def ensure_edit_history_partitions(sb, report: dict | None = None) -> dict | None:
    """Keep quarterly edit_history partitions ahead of now (Phase 2E); never fatal.

    Annotation saves write edit_history in the same transaction, so a missing
    partition for the current date makes every save fail. Calls the
    service-role RPC once (a failure is retried by next week's run) and emits a
    warning when it fails or fewer than EDIT_HISTORY_MIN_FUTURE_QUARTERS full
    quarters remain after the current one. Returns the RPC result or None.
    """
    if report is None:
        report = {}
    name = "ensure_edit_history_partitions"
    started = time.monotonic()
    try:
        result = sb.rpc(name, {"p_quarters_ahead": EDIT_HISTORY_QUARTERS_AHEAD}).execute()
    except Exception as exc:
        reason = describe_maintenance_error(exc)
        report[name] = {"status": "failed (nonfatal)", "attempts": 1, "reason": reason}
        print(f"::warning title=edit_history partition check failed (nonfatal)::{reason}", flush=True)
        return None
    seconds = time.monotonic() - started
    data = getattr(result, "data", None) or {}
    future = int(data.get("future_quarters") or 0)
    horizon = data.get("horizon") or "unknown"
    created = list(data.get("created") or [])
    status = f"ok: {future} future quarter(s), through {horizon}"
    if created:
        status += f"; created {', '.join(created)}"
    report[name] = {"status": status, "attempts": 1, "seconds": seconds}
    print(f"  edit_history partitions: {status}")
    if future < EDIT_HISTORY_MIN_FUTURE_QUARTERS:
        print(
            f"::warning title=edit_history partitions running out::only {future} future quarter(s) "
            f"(through {horizon}); annotation saves fail once no partition covers the current date",
            flush=True,
        )
    return data


def fetch_dicts(conn: duckdb.DuckDBPyConnection, sql: str) -> list[dict]:
    cur = conn.execute(sql)
    names = [c[0] for c in cur.description]
    return [dict(zip(names, row)) for row in cur.fetchall()]


def push_sets(conn, sb, gate: PublishGate | None = None) -> tuple[int, int]:
    gate = gate or PublishGate()
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
    n_tcg = publish(sb, gate, "sets", "sets (TCG)", rows)

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
    n_pocket = publish(sb, gate, "sets", "sets (Pocket)", rows)
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


def push_tcg_cards(conn, sb, now_iso: str, gate: PublishGate | None = None) -> int:
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
    return publish(sb, gate or PublishGate(), "cards", "cards (pokemontcg.io)", rows_out)


def push_pocket_cards(conn, sb, now_iso: str, gate: PublishGate | None = None) -> int:
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
    return publish(sb, gate or PublishGate(), "cards", "cards (tcgdex Pocket)", rows_out)


def ptcgdb_twin_id(set_id: object, number: object) -> str | None:
    """The PTCG-db card ID for the same Japanese card (mirrors ingest.py's ptcgdb IDs)."""
    if not set_id:
        return None
    return f"ptcgdb-{str(set_id).lower().strip()}-{_normalize_jpn_number(number)}"


def staged_ptcgdb_ids(conn) -> set[str]:
    """IDs that ``--include-ptcgdb`` would publish in this run."""
    if not count_staged_ptcgdb_rows(conn):
        return set()
    return {
        row[0]
        for row in conn.execute(
            "SELECT id FROM japanese_cards_ptcgdb WHERE COALESCE(is_custom, FALSE) = FALSE"
        ).fetchall()
    }


JAPANESE_SET_ID_PREFIX = "ja-"
TCGDEX_EN_ASSET_PREFIX = "https://assets.tcgdex.net/en/"


def japanese_card_image(url: str | None) -> str | None:
    """A TCGdex Japanese card's image URL, or None when it points at an English scan.

    Older ingests fell back to ``assets.tcgdex.net/en/{serie}/{set}/{n}`` when the
    Japanese scan was missing. Japanese and English sets that share an ID (``neo1``–
    ``neo4``, ``SM6``–``SM12``) are numbered differently, so that URL showed another
    card (``ja-neo4-034`` "Light Vaporeon" showed English Dark Flaaffy). DuckDB keeps
    those stored URLs, so they are dropped here; the card shows the no-image fallback.
    """
    if not url or url.startswith(TCGDEX_EN_ASSET_PREFIX):
        return None
    return url


def japanese_set_id_map(conn) -> dict[str, str]:
    """Published IDs for TCGdex Japanese sets whose upstream ID is also an English set ID.

    TCGdex Japanese reuses ``neo1``–``neo4``; published unchanged, those rows
    overwrote the English Neo sets and cards (``neo4-100``…``neo4-113``). DuckDB
    keeps upstream IDs (incremental ingest and image URLs depend on them); only
    the published set and card IDs get the ``ja-`` prefix.
    """
    return {
        row[0]: f"{JAPANESE_SET_ID_PREFIX}{row[0]}"
        for row in conn.execute(
            "SELECT j.id FROM japanese_sets j JOIN sets s ON s.id = j.id ORDER BY j.id"
        ).fetchall()
    }


def push_japanese_cards(
    conn,
    sb,
    now_iso: str,
    ptcgdb_ids: set[str] | frozenset = frozenset(),
    gate: PublishGate | None = None,
    set_id_map: dict[str, str] | None = None,
) -> tuple[int, int]:
    """Upsert TCGdex Japanese cards, skipping any whose PTCG-db twin is in ``ptcgdb_ids``.

    Cards in sets listed in ``set_id_map`` are published under the mapped set
    ID with the ``ja-`` card ID prefix. Returns (published, skipped_twins).
    """
    set_id_map = set_id_map or {}
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
    skipped = 0
    for c in fetch_dicts(conn, sql):
        num = c.get("number")
        num_str = str(int(num)) if num is not None else None
        ill = c.get("illustrator") or None
        sid = c.get("set_id") or None
        if ptcgdb_twin_id(sid, num_str) in ptcgdb_ids:
            skipped += 1
            continue
        rows_out.append(
            {
                "id": f"{JAPANESE_SET_ID_PREFIX}{c['id']}" if sid in set_id_map else c["id"],
                "name": c.get("name") or "Unknown",
                "card_type": c.get("card_type") or None,
                "rarity": c.get("rarity") or None,
                "artist": ill,
                "illustrator": ill,
                "set_id": set_id_map.get(sid, sid),
                "set_name": set_names.get(sid) if sid else None,
                "number": num_str,
                "element": c.get("element") or None,
                "hp": str(c["hp"]) if c.get("hp") is not None else None,
                "stage": c.get("stage") or None,
                "retreat_cost": coerce_int(c.get("retreat_cost")),
                "weakness": c.get("weakness") or None,
                "evolves_from": c.get("evolves_from") or None,
                "image_small": japanese_card_image(c.get("image_url")),
                "image_large": japanese_card_image(c.get("image_url")),
                "raw_data": parse_json_col(c.get("raw_data"), {}) or {},
                "origin": "tcgdex",
                "origin_detail": "japanese",
                "format": "printed",
                "last_seen_in_api": now_iso,
            }
        )
    return publish(sb, gate or PublishGate(), "cards", "cards (tcgdex Japanese)", rows_out), skipped


def push_ptcgdb_sets(conn, sb, gate: PublishGate | None = None) -> int:
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
        return publish(sb, gate or PublishGate(), "sets", "sets (PTCG-db)", rows)
    return 0


def push_japanese_cards_ptcgdb(conn, sb, now_iso: str, gate: PublishGate | None = None) -> int:
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
    return publish(sb, gate or PublishGate(), "cards", "cards (PTCG-db Japanese)", rows_out)


def count_staged_ptcgdb_rows(conn) -> int:
    """Publishable rows in ``japanese_cards_ptcgdb`` (0 if the table is absent)."""
    tables = {
        row[0]
        for row in conn.execute(
            "SELECT table_name FROM information_schema.tables WHERE table_schema='main'"
        ).fetchall()
    }
    if "japanese_cards_ptcgdb" not in tables:
        return 0
    return conn.execute(
        "SELECT COUNT(*) FROM japanese_cards_ptcgdb WHERE COALESCE(is_custom, FALSE) = FALSE"
    ).fetchone()[0]


def push_ptcgdb_if_requested(conn, sb, now_iso: str, include: bool, gate: PublishGate | None = None) -> dict:
    """Publish PTCG-db Japanese sets/cards only when explicitly requested.

    Returns {"staged", "included", "sets", "cards"} for logging and the step summary.
    """
    staged = count_staged_ptcgdb_rows(conn)
    result = {"staged": staged, "included": include, "sets": 0, "cards": 0}
    if not include:
        print(f"  cards (PTCG-db Japanese): skipped {staged} staged row(s); pass --include-ptcgdb to publish")
        return result
    if staged:
        result["sets"] = push_ptcgdb_sets(conn, sb, gate)
        if result["sets"]:
            print(f"  sets (PTCG-db): {result['sets']} rows")
        result["cards"] = push_japanese_cards_ptcgdb(conn, sb, now_iso, gate)
    print(f"  cards (PTCG-db Japanese): {result['cards']} rows")
    return result


def format_push_summary(
    counts: dict[str, int],
    ptcgdb: dict | None,
    publish_seconds: float | None,
    maintenance: dict,
    gate: PublishGate | None = None,
) -> str:
    """Markdown for $GITHUB_STEP_SUMMARY. Never includes URLs or keys."""
    lines = ["### Push DuckDB → Supabase", ""]
    if DRY_RUN:
        lines += ["- Mode: **dry run** (no writes)"]
    if publish_seconds is None:
        lines += ["- Publication: **did not finish**"]
    else:
        lines += [f"- Publication duration: {publish_seconds / 60:.1f} min"]
    if ptcgdb is not None:
        if ptcgdb["included"]:
            lines += [f"- PTCG-db: published ({ptcgdb['staged']:,} staged row(s))"]
        else:
            lines += [f"- PTCG-db: skipped {ptcgdb['staged']:,} staged row(s) (opt-in: `--include-ptcgdb`)"]
    if gate is not None and not DRY_RUN:
        lines += [f"- Card fingerprints: {'on (unchanged cards skipped)' if gate.hashes else '**off** (`cards.api_hash` missing; every row rewritten)'}"]
    lines += ["", "| Published | Rows |", "|---|---:|"]
    lines += [f"| {label} | {n:,} |" for label, n in counts.items()]
    if gate is not None:
        lines += [f"| {label} unchanged (skipped) | {n:,} |" for label, n in gate.unchanged.items()]
        if gate.collisions:
            lines += ["", "**ID collisions (skipped; the ID belongs to another origin):**", ""]
            for label, ids in gate.collisions.items():
                shown = ", ".join(f"`{i}`" for i in ids[:COLLISION_IDS_IN_SUMMARY])
                more = f" (+{len(ids) - COLLISION_IDS_IN_SUMMARY:,} more)" if len(ids) > COLLISION_IDS_IN_SUMMARY else ""
                lines += [f"- {label}: {len(ids):,} — {shown}{more}"]
    lines += ["", "| Maintenance RPC | Result | Attempts | Duration |", "|---|---|---:|---:|"]
    for name in ("refresh_explore_filter_options", "analyze_cards_and_annotations", "ensure_edit_history_partitions"):
        step = maintenance.get(name)
        if step is None:
            lines += [f"| `{name}` | not run | | |"]
            continue
        duration = f"{step['seconds']:.1f} s" if "seconds" in step else ""
        reason = " ".join(str(step.get("reason") or "").split()).replace("|", "\\|")
        result = step["status"] + (f": {reason}" if reason else "")
        lines += [f"| `{name}` | {result} | {step['attempts']} | {duration} |"]
    return "\n".join(lines) + "\n\n"


def write_step_summary(markdown: str) -> None:
    """Append to the GitHub Actions step summary when running in CI; never fatal."""
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not path:
        return
    try:
        with open(path, "a", encoding="utf-8") as f:
            f.write(markdown)
    except OSError as exc:
        print(f"  (could not write step summary: {exc})", file=sys.stderr)


def push_japanese_sets(conn, sb, gate: PublishGate | None = None, set_id_map: dict[str, str] | None = None) -> int:
    set_id_map = set_id_map or {}
    rows = []
    for s in fetch_dicts(conn, "SELECT * FROM japanese_sets"):
        rows.append(
            {
                "id": set_id_map.get(s["id"], s["id"]),
                "name": s.get("name") or s["id"],
                "series": s.get("series") or None,
                "release_date": clean_date(s.get("release_date")),
                "card_count": coerce_int(s.get("card_count")),
                "logo_url": s.get("logo_url") or None,
                "origin": "tcgdex",
            }
        )
    return publish(sb, gate or PublishGate(), "sets", "sets (Japanese)", rows)


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

    counts: dict[str, int] = {}
    ptcgdb = None
    gate = None
    publish_seconds = None
    maintenance: dict = {}
    started = time.monotonic()
    try:
        conn = duckdb.connect(str(duck_path), read_only=True)
        try:
            gate = fetch_publish_gate(sb)
            ptcgdb = _publish_all(conn, sb, now_iso, counts, gate)
        finally:
            conn.close()
        publish_seconds = time.monotonic() - started

        if not DRY_RUN and sb:
            # Nonfatal and independent of publication; runs first so a fatal
            # refresh failure cannot skip it.
            ensure_edit_history_partitions(sb, maintenance)
            # Refresh the Explore filter options materialized view and planner stats.
            refresh_post_push_data(sb, maintenance)
    finally:
        write_step_summary(format_push_summary(counts, ptcgdb, publish_seconds, maintenance, gate))

    print("Done.")


def _publish_all(conn, sb, now_iso: str, counts: dict[str, int], gate: PublishGate) -> dict:
    """Upsert every source through ``gate``, filling ``counts`` as each step finishes.

    Returns the PTCG-db result from push_ptcgdb_if_requested.
    """
    set_id_map = japanese_set_id_map(conn)
    if set_id_map:
        print(f"  Japanese sets published with the '{JAPANESE_SET_ID_PREFIX}' prefix: {', '.join(set_id_map)}")

    counts["sets (TCG)"], counts["sets (Pocket)"] = push_sets(conn, sb, gate)
    print(f"  sets (TCG): {counts['sets (TCG)']} rows")
    print(f"  sets (Pocket): {counts['sets (Pocket)']} rows")

    counts["sets (Japanese)"] = push_japanese_sets(conn, sb, gate, set_id_map)
    print(f"  sets (Japanese): {counts['sets (Japanese)']} rows")

    counts["pokemon_metadata"] = push_pokemon_metadata(conn, sb)
    print(f"  pokemon_metadata: {counts['pokemon_metadata']} rows")

    counts["cards (pokemontcg.io)"] = push_tcg_cards(conn, sb, now_iso, gate)
    print(f"  cards (pokemontcg.io): {counts['cards (pokemontcg.io)']} rows")

    counts["cards (tcgdex Pocket)"] = push_pocket_cards(conn, sb, now_iso, gate)
    print(f"  cards (tcgdex Pocket): {counts['cards (tcgdex Pocket)']} rows")

    ptcgdb_ids = gate.ids_with_origin("ptcgdb")
    if INCLUDE_PTCGDB:
        ptcgdb_ids |= staged_ptcgdb_ids(conn)
    published, skipped = push_japanese_cards(conn, sb, now_iso, ptcgdb_ids, gate, set_id_map)
    counts["cards (tcgdex Japanese)"] = published
    counts["tcgdex Japanese skipped (PTCG-db twin)"] = skipped
    print(f"  cards (tcgdex Japanese): {published} rows; skipped {skipped} with a PTCG-db twin")

    ptcgdb = push_ptcgdb_if_requested(conn, sb, now_iso, INCLUDE_PTCGDB, gate)
    if ptcgdb["included"]:
        counts["sets (PTCG-db)"] = ptcgdb["sets"]
        counts["cards (PTCG-db Japanese)"] = ptcgdb["cards"]

    for label, n in gate.unchanged.items():
        print(f"  {label}: {n} unchanged (skipped)")
    report_collisions(gate)
    return ptcgdb


def report_collisions(gate: PublishGate) -> None:
    """Log ID collisions (skipped rows owned by another origin) as a CI warning."""
    for label, ids in gate.collisions.items():
        shown = ", ".join(ids[:COLLISION_IDS_IN_SUMMARY])
        more = f" (+{len(ids) - COLLISION_IDS_IN_SUMMARY} more)" if len(ids) > COLLISION_IDS_IN_SUMMARY else ""
        print(
            f"::warning title=ID collision ({label})::{len(ids)} row(s) skipped because the ID "
            f"belongs to another origin: {shown}{more}",
            flush=True,
        )


if __name__ == "__main__":
    main()
