#!/usr/bin/env python3
"""Focused tests for adaptive Supabase ingest batching and post-push maintenance."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import duckdb

import push_duckdb_to_supabase as push
from postgrest.exceptions import APIError


class _FakeRequest:
    def __init__(self, client, rows, returning):
        self.client = client
        self.rows = rows
        self.returning = returning

    def execute(self):
        self.client.attempted_sizes.append(len(self.rows))
        if len(self.rows) > self.client.max_rows:
            raise RuntimeError("57014: canceling statement due to statement timeout")
        self.client.pushed_ids.extend(row["id"] for row in self.rows)


class _FakeTable:
    def __init__(self, client):
        self.client = client

    def upsert(self, rows, *, returning):
        self.client.returning_values.append(returning)
        return _FakeRequest(self.client, rows, returning)


class _FakeClient:
    def __init__(self, max_rows):
        self.max_rows = max_rows
        self.attempted_sizes = []
        self.pushed_ids = []
        self.returning_values = []

    def table(self, _name):
        return _FakeTable(self)


class BatchUpsertTests(unittest.TestCase):
    def test_timeout_shrinks_batches_without_duplicates_or_skips(self):
        rows = [{"id": str(i)} for i in range(235)]
        client = _FakeClient(max_rows=40)

        with patch.object(push.time, "sleep", return_value=None):
            count = push.batch_upsert(client, "cards", rows)

        self.assertEqual(count, len(rows))
        self.assertEqual(client.pushed_ids, [row["id"] for row in rows])
        self.assertEqual(len(client.pushed_ids), len(set(client.pushed_ids)))
        self.assertEqual(client.attempted_sizes[:3], [100, 50, 25])
        self.assertTrue(
            all(value == push.ReturnMethod.minimal for value in client.returning_values)
        )

    def test_non_timeout_error_is_not_retried(self):
        class FailingRequest:
            def execute(self):
                raise RuntimeError("permission denied")

        class FailingTable:
            def upsert(self, _rows, *, returning):
                return FailingRequest()

        class FailingClient:
            def table(self, _name):
                return FailingTable()

        with self.assertRaisesRegex(RuntimeError, "permission denied"):
            push.batch_upsert(FailingClient(), "cards", [{"id": "1"}])

    def _run(self, client, rows):
        with patch.object(push.time, "sleep", return_value=None), \
                patch("builtins.print"):
            return push.batch_upsert(client, "cards", rows)

    def _assert_exactly_once(self, client, rows):
        self.assertEqual(client.pushed_ids, [row["id"] for row in rows])

    def test_repeated_timeouts_shrink_and_reduced_size_persists(self):
        rows = [{"id": str(i)} for i in range(108)]
        client = _FakeClient(max_rows=12)

        self.assertEqual(self._run(client, rows), len(rows))

        self.assertEqual(client.attempted_sizes[:4], [100, 50, 25, 12])
        self.assertEqual(client.attempted_sizes[4:], [12] * 8)
        self._assert_exactly_once(client, rows)

    def test_shrinks_to_minimum_batch_size_and_succeeds(self):
        rows = [{"id": str(i)} for i in range(35)]
        client = _FakeClient(max_rows=push.MIN_BATCH_SIZE)

        self.assertEqual(self._run(client, rows), len(rows))

        self.assertEqual(client.attempted_sizes, [35, 17, 10, 10, 10, 5])
        self._assert_exactly_once(client, rows)

    def test_timeout_at_minimum_batch_size_is_fatal(self):
        rows = [{"id": str(i)} for i in range(30)]
        client = _FakeClient(max_rows=push.MIN_BATCH_SIZE - 1)

        with self.assertRaisesRegex(RuntimeError, "57014"):
            self._run(client, rows)

        self.assertEqual(client.attempted_sizes, [30, 15, push.MIN_BATCH_SIZE])
        self.assertEqual(client.pushed_ids, [])

    def test_final_short_batch_without_timeouts(self):
        rows = [{"id": str(i)} for i in range(push.BATCH_SIZE * 2 + 5)]
        client = _FakeClient(max_rows=10_000)

        self.assertEqual(self._run(client, rows), len(rows))

        self.assertEqual(client.attempted_sizes, [push.BATCH_SIZE, push.BATCH_SIZE, 5])
        self._assert_exactly_once(client, rows)

    def test_final_short_batch_after_shrink(self):
        rows = [{"id": str(i)} for i in range(107)]
        client = _FakeClient(max_rows=50)

        self.assertEqual(self._run(client, rows), len(rows))

        self.assertEqual(client.attempted_sizes, [100, 50, 50, 7])
        self._assert_exactly_once(client, rows)

    def test_statement_timeout_text_without_code_is_retried(self):
        client = _FakeClient(max_rows=50)
        original_execute = _FakeRequest.execute

        def execute(request):
            if len(request.rows) > request.client.max_rows:
                request.client.attempted_sizes.append(len(request.rows))
                raise RuntimeError("canceling statement due to statement timeout")
            return original_execute(request)

        rows = [{"id": str(i)} for i in range(100)]
        with patch.object(_FakeRequest, "execute", execute):
            self.assertEqual(self._run(client, rows), len(rows))
        self._assert_exactly_once(client, rows)

    def test_non_timeout_error_after_shrink_is_fatal(self):
        rows = [{"id": str(i)} for i in range(100)]
        client = _FakeClient(max_rows=50)
        original_execute = _FakeRequest.execute

        def execute(request):
            if request.client.attempted_sizes == [100, 50]:
                request.client.attempted_sizes.append(len(request.rows))
                raise RuntimeError("duplicate key value violates unique constraint")
            return original_execute(request)

        with patch.object(_FakeRequest, "execute", execute):
            with self.assertRaisesRegex(RuntimeError, "duplicate key"):
                self._run(client, rows)

        self.assertEqual(client.attempted_sizes, [100, 50, 50])
        self.assertEqual(client.pushed_ids, [str(i) for i in range(50)])

    def test_dry_run_counts_rows_without_requests(self):
        rows = [{"id": str(i)} for i in range(205)]
        client = _FakeClient(max_rows=0)

        with patch.object(push, "DRY_RUN", True):
            self.assertEqual(self._run(client, rows), len(rows))

        self.assertEqual(client.attempted_sizes, [])


class PostPushMaintenanceTests(unittest.TestCase):
    def test_zero_argument_rpcs_receive_empty_params(self):
        class Request:
            def execute(self):
                return None

        class Client:
            def __init__(self):
                self.calls = []

            def rpc(self, function_name, params):
                self.calls.append((function_name, params))
                return Request()

        client = Client()
        with patch("builtins.print"):
            result = push.refresh_post_push_data(client)

        self.assertEqual(result, (True, True))
        self.assertEqual(
            client.calls,
            [
                ("refresh_explore_filter_options", {}),
                ("analyze_cards_and_annotations", {}),
            ],
        )


class _ScriptedRpcClient:
    """RPC client whose calls fail per a script of exceptions, then succeed."""

    def __init__(self, failures=None):
        # function name -> list of exceptions to raise on successive calls
        self.failures = {name: list(errs) for name, errs in (failures or {}).items()}
        self.calls = []

    def rpc(self, function_name, params):
        self.calls.append((function_name, params))
        client = self

        class Request:
            def execute(self_inner):
                pending = client.failures.get(function_name)
                if pending:
                    raise pending.pop(0)
                return None

        return Request()


def _timeout():
    return APIError(
        {"code": "57014", "message": "canceling statement due to statement timeout"}
    )


class MaintenanceRetryTests(unittest.TestCase):
    def _run(self, client):
        printed = []
        with patch.object(push.time, "sleep") as sleep, \
                patch("builtins.print", side_effect=lambda *a, **k: printed.append(" ".join(map(str, a)))):
            try:
                result = push.refresh_post_push_data(client)
            except Exception as exc:  # noqa: BLE001 - surfaced to the test
                return exc, sleep, printed
        return result, sleep, printed

    def _count(self, client, name):
        return sum(1 for fn, _ in client.calls if fn == name)

    def test_immediate_success_makes_one_call_each_and_does_not_sleep(self):
        client = _ScriptedRpcClient()
        result, sleep, _ = self._run(client)
        self.assertEqual(result, (True, True))
        self.assertEqual(self._count(client, "refresh_explore_filter_options"), 1)
        self.assertEqual(self._count(client, "analyze_cards_and_annotations"), 1)
        sleep.assert_not_called()

    def test_transient_refresh_failure_then_success(self):
        client = _ScriptedRpcClient(
            {"refresh_explore_filter_options": [_timeout(), ConnectionResetError("reset by peer")]}
        )
        result, sleep, printed = self._run(client)
        self.assertEqual(result, (True, True))
        self.assertEqual(self._count(client, "refresh_explore_filter_options"), 3)
        self.assertEqual([c.args[0] for c in sleep.call_args_list], list(push.MAINTENANCE_BACKOFF_SECONDS[:2]))
        self.assertTrue(any("attempts: 3" in line for line in printed))

    def test_retry_window_outlasts_post_upsert_io_window(self):
        # Attempts that all time out plus the waits between them must span one
        # checkpoint cycle, so a later attempt runs after the post-upsert flush.
        waits = [
            push.MAINTENANCE_BACKOFF_SECONDS[min(i, len(push.MAINTENANCE_BACKOFF_SECONDS) - 1)]
            for i in range(push.MAINTENANCE_MAX_ATTEMPTS - 1)
        ]
        last_attempt_starts = (
            (push.MAINTENANCE_MAX_ATTEMPTS - 1) * push.MAINTENANCE_STATEMENT_TIMEOUT_SECONDS + sum(waits)
        )
        self.assertGreater(last_attempt_starts, push.POST_UPSERT_IO_WINDOW_SECONDS)

    def test_gateway_5xx_is_retried(self):
        gateway = APIError(
            {"code": 504, "message": "JSON could not be generated", "details": "<html>"}
        )
        client = _ScriptedRpcClient({"refresh_explore_filter_options": [gateway]})
        result, _, _ = self._run(client)
        self.assertEqual(result, (True, True))
        self.assertEqual(self._count(client, "refresh_explore_filter_options"), 2)

    def test_exhausted_refresh_is_fatal_and_skips_analyze(self):
        client = _ScriptedRpcClient(
            {"refresh_explore_filter_options": [_timeout() for _ in range(push.MAINTENANCE_MAX_ATTEMPTS)]}
        )
        exc, sleep, printed = self._run(client)
        self.assertIsInstance(exc, push.MaintenanceRpcError)
        self.assertEqual(exc.attempts, push.MAINTENANCE_MAX_ATTEMPTS)
        self.assertIn("57014", exc.reason)
        self.assertEqual(self._count(client, "refresh_explore_filter_options"), push.MAINTENANCE_MAX_ATTEMPTS)
        self.assertEqual(self._count(client, "analyze_cards_and_annotations"), 0)
        self.assertEqual(sleep.call_count, push.MAINTENANCE_MAX_ATTEMPTS - 1)
        self.assertTrue(any(line.startswith("::error") for line in printed))

    def test_non_transient_refresh_error_fails_immediately(self):
        denied = APIError({"code": "42501", "message": "permission denied for materialized view"})
        client = _ScriptedRpcClient({"refresh_explore_filter_options": [denied]})
        exc, sleep, _ = self._run(client)
        self.assertIsInstance(exc, push.MaintenanceRpcError)
        self.assertEqual(exc.attempts, 1)
        self.assertIn("non-retryable", exc.reason)
        self.assertEqual(self._count(client, "refresh_explore_filter_options"), 1)
        sleep.assert_not_called()

    def test_exhausted_analyze_is_nonfatal_and_reported(self):
        client = _ScriptedRpcClient(
            {"analyze_cards_and_annotations": [_timeout() for _ in range(push.MAINTENANCE_MAX_ATTEMPTS)]}
        )
        result, _, printed = self._run(client)
        self.assertEqual(result, (True, False))
        self.assertEqual(self._count(client, "analyze_cards_and_annotations"), push.MAINTENANCE_MAX_ATTEMPTS)
        warnings = [line for line in printed if line.startswith("::warning")]
        self.assertEqual(len(warnings), 1)
        payload = json.loads(warnings[0].split("::", 2)[2])
        self.assertEqual(payload["step"], "analyze_cards_and_annotations")
        self.assertEqual(payload["status"], "failed_nonfatal")
        self.assertEqual(payload["attempts"], push.MAINTENANCE_MAX_ATTEMPTS)
        self.assertIn("57014", payload["final_reason"])

    def test_zero_argument_rpcs_still_receive_empty_params_on_retry(self):
        client = _ScriptedRpcClient({"analyze_cards_and_annotations": [_timeout()]})
        self._run(client)
        self.assertTrue(all(params == {} for _, params in client.calls))

    def test_reported_reason_never_contains_the_service_key(self):
        secret = "eyJhbGciOiJIUzI1NiJ9.service.secret"
        with patch.dict("os.environ", {"SUPABASE_SERVICE_KEY": secret}):
            client = _ScriptedRpcClient(
                {"refresh_explore_filter_options": [_timeout() for _ in range(push.MAINTENANCE_MAX_ATTEMPTS)]}
            )
            exc, _, printed = self._run(client)
        self.assertNotIn(secret, exc.reason)
        self.assertFalse(any(secret in line for line in printed))


def _ptcgdb_db(tmp, rows):
    """DuckDB file with a japanese_cards_ptcgdb table holding ``rows`` (id, set_id, is_custom)."""
    db_path = str(Path(tmp) / "ptcgdb.duckdb")
    conn = duckdb.connect(db_path)
    try:
        conn.execute(
            "CREATE TABLE japanese_cards_ptcgdb ("
            "id VARCHAR PRIMARY KEY, name VARCHAR, set_id VARCHAR, number VARCHAR, "
            "types JSON, subtypes JSON, raw_data JSON, is_custom BOOLEAN DEFAULT FALSE)"
        )
        for card_id, set_id, is_custom in rows:
            conn.execute(
                "INSERT INTO japanese_cards_ptcgdb (id, name, set_id, number, is_custom) "
                "VALUES (?, ?, ?, '1', ?)",
                [card_id, card_id, set_id, is_custom],
            )
    finally:
        conn.close()
    return duckdb.connect(db_path, read_only=True)


class PtcgdbOptInTests(unittest.TestCase):
    def test_staged_rows_are_skipped_by_default(self):
        with tempfile.TemporaryDirectory() as tmp:
            conn = _ptcgdb_db(tmp, [("ptcgdb-sv4a-1", "sv4a", False), ("ptcgdb-sv4a-2", "sv4a", False)])
            client = _FakeClient(max_rows=1000)
            try:
                with patch("builtins.print"):
                    result = push.push_ptcgdb_if_requested(conn, client, "now", include=False)
            finally:
                conn.close()

        self.assertEqual(result, {"staged": 2, "included": False, "sets": 0, "cards": 0})
        self.assertEqual(client.attempted_sizes, [])

    def test_explicit_opt_in_publishes_sets_and_cards(self):
        with tempfile.TemporaryDirectory() as tmp:
            conn = _ptcgdb_db(tmp, [("ptcgdb-sv4a-1", "sv4a", False), ("custom-1", "sv4a", True)])
            client = _FakeClient(max_rows=1000)
            try:
                with patch("builtins.print"):
                    result = push.push_ptcgdb_if_requested(conn, client, "now", include=True)
            finally:
                conn.close()

        self.assertEqual(result, {"staged": 1, "included": True, "sets": 1, "cards": 1})
        self.assertEqual(client.pushed_ids, ["sv4a", "ptcgdb-sv4a-1"])

    def test_missing_table_counts_zero_staged_rows(self):
        with tempfile.TemporaryDirectory() as tmp:
            conn = duckdb.connect(str(Path(tmp) / "empty.duckdb"))
            try:
                self.assertEqual(push.count_staged_ptcgdb_rows(conn), 0)
            finally:
                conn.close()

    def test_flag_defaults_off(self):
        self.assertFalse(push.INCLUDE_PTCGDB)


def _capture_upserts(test_body):
    """Run ``test_body()`` with batch_upsert recording (table, rows); returns the records."""
    captured = []
    original = push.batch_upsert
    with patch.object(push, "batch_upsert", side_effect=lambda sb, t, rows: captured.append((t, rows)) or original(sb, t, rows)):
        test_body()
    return captured


class PtcgdbSetNameTests(unittest.TestCase):
    def test_reviewed_table_maps_every_code_to_an_owned_set(self):
        names = push.load_ptcgdb_set_names()
        self.assertEqual(len(names), 314)
        published = {v["set_id"] for v in names.values()}
        self.assertEqual(len(published), 312)
        self.assertEqual(sum(1 for sid in published if sid.startswith("ja-")), 27)
        self.assertEqual(
            names["sv9"],
            {"set_id": "ja-sv9", "name": "SV9: Battle Partners", "series": "Japanese Scarlet & Violet", "release_date": "2025-01-24"},
        )
        self.assertEqual(names["xy6"], names["xy6-b"])
        self.assertEqual(names["xy7"]["set_id"], "xy7-b")
        self.assertEqual(names["sv4a"]["set_id"], "sv4a")
        self.assertTrue(all(v["name"] and v["series"].startswith("Japanese ") for v in names.values()))

    def test_code_folded_into_a_set_no_code_owns_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "names.json"
            path.write_text(json.dumps({"sets": [
                {"code": "xy6", "set_id": "xy6-b", "name": "XY6: Emerald Break", "series": "Japanese XY", "release_date": None},
            ]}), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "xy6 maps to xy6-b"):
                push.load_ptcgdb_set_names(path)

    def test_sets_and_cards_publish_under_the_reviewed_set(self):
        names = push.load_ptcgdb_set_names()
        with tempfile.TemporaryDirectory() as tmp:
            conn = _ptcgdb_db(tmp, [
                ("ptcgdb-sv9-40", "sv9", False),
                ("ptcgdb-xy6-80", "xy6", False),
                ("ptcgdb-xy6-b-1", "xy6-b", False),
                ("ptcgdb-zz9-1", "zz9", False),
            ])
            client = _FakeClient(max_rows=1000)
            gate = push.PublishGate({}, {"sv9": "pokemontcg.io", "xy6": "pokemontcg.io"}, hashes=True)
            try:
                with patch("builtins.print"):
                    captured = _capture_upserts(lambda: (
                        push.push_ptcgdb_sets(conn, client, gate, names),
                        push.push_japanese_cards_ptcgdb(conn, client, "now", gate, names),
                    ))
            finally:
                conn.close()

        sets_rows = {r["id"]: r for t, rows in captured if t == "sets" for r in rows}
        cards_rows = {r["id"]: r for t, rows in captured if t == "cards" for r in rows}
        self.assertEqual(sorted(sets_rows), ["ja-sv9", "xy6-b", "zz9"])
        self.assertEqual(sets_rows["ja-sv9"]["name"], "SV9: Battle Partners")
        self.assertEqual(sets_rows["ja-sv9"]["series"], "Japanese Scarlet & Violet")
        self.assertEqual(sets_rows["ja-sv9"]["release_date"], "2025-01-24")
        self.assertEqual(sets_rows["xy6-b"]["name"], names["xy6-b"]["name"])
        self.assertEqual(sets_rows["zz9"], {"id": "zz9", "name": "ZZ9", "series": None, "release_date": None, "origin": "ptcgdb"})
        self.assertEqual(
            {k: (v["set_id"], v["set_name"]) for k, v in cards_rows.items()},
            {
                "ptcgdb-sv9-40": ("ja-sv9", "SV9: Battle Partners"),
                "ptcgdb-xy6-80": ("xy6-b", names["xy6-b"]["name"]),
                "ptcgdb-xy6-b-1": ("xy6-b", names["xy6-b"]["name"]),
                "ptcgdb-zz9-1": ("zz9", None),
            },
        )
        self.assertEqual(cards_rows["ptcgdb-sv9-40"]["set_series"], "Japanese Scarlet & Violet")
        self.assertEqual(gate.collisions, {})  # English sv9/xy6 are never written

    def test_unknown_codes_are_reported(self):
        with tempfile.TemporaryDirectory() as tmp:
            conn = _ptcgdb_db(tmp, [("ptcgdb-zz9-1", "zz9", False)])
            try:
                with patch("builtins.print") as printed:
                    push.push_ptcgdb_sets(conn, _FakeClient(max_rows=1000), None, {})
            finally:
                conn.close()
        self.assertIn("zz9", " ".join(str(c.args[0]) for c in printed.call_args_list if c.args))


class PtcgdbSetNamesSqlTests(unittest.TestCase):
    MIGRATION = "20260927072333_ptcgdb_japanese_set_names.sql"

    def test_committed_migration_matches_the_name_table(self):
        path = push.SCRIPT_DIR.parent / "supabase" / "migrations" / self.MIGRATION
        if not path.is_file():
            self.skipTest("migration not in this checkout (main carries the push script only)")
        import hashlib

        import generate_ptcgdb_set_names_sql as gen

        expected = gen.build_sql(gen.load_entries(), hashlib.sha256(gen.NAMES_PATH.read_bytes()).hexdigest())
        self.assertEqual(
            path.read_text(encoding="utf-8"),
            expected,
            "regenerate: python scripts/generate_ptcgdb_set_names_sql.py supabase/migrations/" + self.MIGRATION,
        )
        self.assertIn("Move 3,545 ptcgdb cards", expected)
        self.assertIn("Upsert 312 ptcgdb sets", expected)


class PocketSetNameTests(unittest.TestCase):
    def _db(self, tmp):
        path = str(Path(tmp) / "pocket.duckdb")
        conn = duckdb.connect(path)
        try:
            conn.execute("CREATE TABLE sets (id VARCHAR PRIMARY KEY, name VARCHAR, series VARCHAR)")
            conn.execute(
                "CREATE TABLE pocket_sets (id VARCHAR PRIMARY KEY, name VARCHAR, series VARCHAR, "
                "release_date VARCHAR, card_count INTEGER, packs JSON, logo_url VARCHAR)"
            )
            conn.execute("INSERT INTO pocket_sets (id, name, series) VALUES ('A1', 'Genetic Apex', 'tcgp'), ('Z1', NULL, 'other')")
            conn.execute(
                "CREATE TABLE pocket_cards (id VARCHAR PRIMARY KEY, name VARCHAR, set_id VARCHAR, number INTEGER, "
                "illustrator VARCHAR, raw_data JSON, is_custom BOOLEAN DEFAULT FALSE)"
            )
            conn.execute(
                "INSERT INTO pocket_cards (id, name, set_id, number) VALUES "
                "('A1-001', 'Bulbasaur', 'A1', 1), ('Z1-001', 'Mew', 'Z1', 1), ('X9-001', 'Eevee', 'X9', 1)"
            )
        finally:
            conn.close()
        return duckdb.connect(path, read_only=True)

    def test_series_label_replaces_the_tcgdex_serie_id(self):
        self.assertEqual(push.pocket_series("tcgp"), "Pokémon TCG Pocket")
        self.assertEqual(push.pocket_series("other"), "other")
        self.assertIsNone(push.pocket_series(""))

    def test_sets_and_cards_carry_the_set_name_and_series(self):
        with tempfile.TemporaryDirectory() as tmp:
            conn = self._db(tmp)
            client = _FakeClient(max_rows=1000)
            try:
                captured = _capture_upserts(lambda: (
                    push.push_sets(conn, client),
                    push.push_pocket_cards(conn, client, "now"),
                ))
            finally:
                conn.close()

        pocket_sets = {r["id"]: r for t, rows in captured if t == "sets" for r in rows if r["origin"] == "tcgdex"}
        cards = {r["id"]: r for t, rows in captured if t == "cards" for r in rows}
        self.assertEqual(pocket_sets["A1"]["series"], "Pokémon TCG Pocket")
        self.assertEqual((cards["A1-001"]["set_name"], cards["A1-001"]["set_series"]), ("Genetic Apex", "Pokémon TCG Pocket"))
        self.assertEqual((cards["Z1-001"]["set_name"], cards["Z1-001"]["set_series"]), ("Z1", "other"))
        self.assertEqual((cards["X9-001"]["set_name"], cards["X9-001"]["set_series"]), (None, None))


def _tcgdex_japanese_db(tmp, rows):
    """DuckDB file with japanese_cards holding ``rows`` (id, set_id, number, is_custom)."""
    db_path = str(Path(tmp) / "japanese.duckdb")
    conn = duckdb.connect(db_path)
    try:
        conn.execute("CREATE TABLE japanese_sets (id VARCHAR PRIMARY KEY, name VARCHAR)")
        conn.execute(
            "CREATE TABLE japanese_cards ("
            "id VARCHAR PRIMARY KEY, name VARCHAR, card_type VARCHAR, rarity VARCHAR, "
            "illustrator VARCHAR, set_id VARCHAR, number INTEGER, element VARCHAR, hp INTEGER, "
            "stage VARCHAR, retreat_cost INTEGER, weakness VARCHAR, evolves_from VARCHAR, "
            "image_url VARCHAR, raw_data JSON, is_custom BOOLEAN DEFAULT FALSE)"
        )
        for card_id, set_id, number, is_custom in rows:
            conn.execute(
                "INSERT INTO japanese_cards (id, name, set_id, number, is_custom) VALUES (?, ?, ?, ?, ?)",
                [card_id, card_id, set_id, number, is_custom],
            )
    finally:
        conn.close()
    return duckdb.connect(db_path, read_only=True)


class _PagedRowsClient:
    """Serves each table's rows in ID order, one keyset page per query.

    Selecting a column listed in ``missing_columns`` raises PostgREST's
    undefined-column error, like a query against an unmigrated schema.
    """

    def __init__(self, tables, missing_columns=()):
        self.tables = {name: sorted(rows, key=lambda r: r["id"]) for name, rows in tables.items()}
        self.missing_columns = set(missing_columns)
        self.queries = []

    def table(self, name):
        client = self

        class Query:
            def __init__(self):
                self.filters = {"table": name}

            def select(self, cols):
                self.filters["select"] = cols
                return self

            def gt(self, col, value):
                self.filters[f"gt:{col}"] = value
                return self

            def order(self, col):
                return self

            def limit(self, n):
                self.filters["limit"] = n
                return self

            def execute(self):
                client.queries.append(self.filters)
                columns = self.filters["select"].split(",")
                for col in columns:
                    if col in client.missing_columns:
                        raise APIError({"code": "42703", "message": f"column {name}.{col} does not exist"})
                after = self.filters.get("gt:id")
                rows = [r for r in client.tables.get(name, []) if after is None or r["id"] > after]
                page = [{c: r.get(c) for c in columns} for r in rows[: self.filters["limit"]]]
                return type("Response", (), {"data": page})()

        return Query()


class TcgdexJapaneseTwinTests(unittest.TestCase):
    def test_twin_id_matches_ingest_ptcgdb_ids(self):
        self.assertEqual(push.ptcgdb_twin_id("SV4a", "005"), "ptcgdb-sv4a-5")
        self.assertEqual(push.ptcgdb_twin_id("SV-P", "21"), "ptcgdb-sv-p-21")
        self.assertEqual(push.ptcgdb_twin_id("SM12a", "172"), "ptcgdb-sm12a-172")
        self.assertIsNone(push.ptcgdb_twin_id(None, "1"))

    def test_rows_with_a_ptcgdb_twin_are_skipped(self):
        with tempfile.TemporaryDirectory() as tmp:
            conn = _tcgdex_japanese_db(
                tmp,
                [
                    ("SV4a-005", "SV4a", 5, False),   # twin published → skip
                    ("SV4a-006", "SV4a", 6, False),   # no twin → publish
                    ("SM1-001", "SM1", 1, False),     # no twin → publish
                    ("SV4a-007", "SV4a", 7, True),    # custom → never published
                ],
            )
            client = _FakeClient(max_rows=1000)
            try:
                published, skipped = push.push_japanese_cards(
                    conn, client, "now", {"ptcgdb-sv4a-5", "ptcgdb-sv4a-7"}
                )
            finally:
                conn.close()

        self.assertEqual((published, skipped), (2, 1))
        self.assertEqual(client.pushed_ids, ["SV4a-006", "SM1-001"])

    def test_without_ptcgdb_ids_everything_publishes(self):
        with tempfile.TemporaryDirectory() as tmp:
            conn = _tcgdex_japanese_db(tmp, [("SV4a-005", "SV4a", 5, False)])
            client = _FakeClient(max_rows=1000)
            try:
                self.assertEqual(push.push_japanese_cards(conn, client, "now"), (1, 0))
            finally:
                conn.close()

    def test_english_asset_images_are_not_published_for_japanese_cards(self):
        self.assertIsNone(push.japanese_card_image("https://assets.tcgdex.net/en/neo/neo4/34/high.webp"))
        self.assertIsNone(push.japanese_card_image(None))
        self.assertIsNone(push.japanese_card_image(""))
        ja = "https://assets.tcgdex.net/ja/SV/SV4a/005/high.webp"
        self.assertEqual(push.japanese_card_image(ja), ja)

        with tempfile.TemporaryDirectory() as tmp:
            conn = _tcgdex_japanese_db(tmp, [("neo4-034", "neo4", 34, False), ("SV4a-005", "SV4a", 5, False)])
            conn.close()
            rw = duckdb.connect(str(Path(tmp) / "japanese.duckdb"))
            rw.execute("UPDATE japanese_cards SET image_url = ? WHERE id = 'neo4-034'",
                       ["https://assets.tcgdex.net/en/neo/neo4/34/high.webp"])
            rw.execute("UPDATE japanese_cards SET image_url = ? WHERE id = 'SV4a-005'", [ja])
            rw.close()
            conn = duckdb.connect(str(Path(tmp) / "japanese.duckdb"), read_only=True)
            captured = []
            try:
                with patch.object(push, "batch_upsert", side_effect=lambda sb, t, rows: captured.extend(rows)):
                    push.push_japanese_cards(conn, _FakeClient(max_rows=1000), "now")
            finally:
                conn.close()

        images = {r["id"]: (r["image_small"], r["image_large"]) for r in captured}
        self.assertEqual(images["neo4-034"], (None, None))
        self.assertEqual(images["SV4a-005"], (ja, ja))

    def test_existing_rows_are_keyset_paged(self):
        ids = [f"card-{i:04d}" for i in range(5)]
        client = _PagedRowsClient({"cards": [{"id": i, "origin": "tcgdex"} for i in ids]})
        with patch.object(push, "EXISTING_PAGE_SIZE", 2):
            rows = push.fetch_all_rows(client, "cards", "id,origin")

        self.assertEqual([r["id"] for r in rows], ids)
        self.assertEqual([q.get("gt:id") for q in client.queries], [None, ids[1], ids[3]])
        self.assertTrue(all(q["select"] == "id,origin" for q in client.queries))

    def test_exact_page_multiple_ends_on_empty_page(self):
        client = _PagedRowsClient({"cards": [{"id": "a"}, {"id": "b"}]})
        with patch.object(push, "EXISTING_PAGE_SIZE", 2):
            self.assertEqual(len(push.fetch_all_rows(client, "cards", "id")), 2)
        self.assertEqual(len(client.queries), 2)

    def test_published_ptcgdb_ids_come_from_the_gate(self):
        gate = push.PublishGate({"ptcgdb-sv4a-5": ("ptcgdb", None), "SV4a-006": ("tcgdex", None)})
        self.assertEqual(gate.ids_with_origin("ptcgdb"), {"ptcgdb-sv4a-5"})

    def test_staged_ids_exclude_custom_rows_and_missing_table(self):
        with tempfile.TemporaryDirectory() as tmp:
            conn = _ptcgdb_db(tmp, [("ptcgdb-sv4a-1", "sv4a", False), ("custom-1", "sv4a", True)])
            try:
                self.assertEqual(push.staged_ptcgdb_ids(conn), {"ptcgdb-sv4a-1"})
            finally:
                conn.close()
            empty = duckdb.connect(str(Path(tmp) / "empty.duckdb"))
            try:
                self.assertEqual(push.staged_ptcgdb_ids(empty), set())
            finally:
                empty.close()


class StepSummaryTests(unittest.TestCase):
    def test_maintenance_outcomes_are_recorded_for_the_summary(self):
        client = _ScriptedRpcClient(
            {"analyze_cards_and_annotations": [_timeout() for _ in range(push.MAINTENANCE_MAX_ATTEMPTS)]}
        )
        report = {}
        with patch.object(push.time, "sleep"), patch("builtins.print"):
            push.refresh_post_push_data(client, report)

        self.assertEqual(report["refresh_explore_filter_options"]["status"], "ok")
        self.assertEqual(report["refresh_explore_filter_options"]["attempts"], 1)
        self.assertIn("seconds", report["refresh_explore_filter_options"])
        self.assertEqual(report["analyze_cards_and_annotations"]["status"], "failed (nonfatal)")
        self.assertIn("57014", report["analyze_cards_and_annotations"]["reason"])

    def test_fatal_refresh_failure_is_recorded_before_raising(self):
        client = _ScriptedRpcClient(
            {"refresh_explore_filter_options": [_timeout() for _ in range(push.MAINTENANCE_MAX_ATTEMPTS)]}
        )
        report = {}
        with patch.object(push.time, "sleep"), patch("builtins.print"):
            with self.assertRaises(push.MaintenanceRpcError):
                push.refresh_post_push_data(client, report)

        self.assertEqual(report["refresh_explore_filter_options"]["status"], "failed")
        self.assertNotIn("analyze_cards_and_annotations", report)

    def test_summary_lists_counts_ptcgdb_skip_and_maintenance(self):
        text = push.format_push_summary(
            {"cards (pokemontcg.io)": 20670},
            {"staged": 3, "included": False, "sets": 0, "cards": 0},
            95.0,
            {
                "refresh_explore_filter_options": {"status": "ok", "attempts": 1, "seconds": 12.3},
                "analyze_cards_and_annotations": {
                    "status": "failed (nonfatal)", "attempts": 3, "reason": "57014: timeout",
                },
            },
        )
        self.assertIn("| cards (pokemontcg.io) | 20,670 |", text)
        self.assertIn("skipped 3 staged row(s)", text)
        self.assertIn("Publication duration: 1.6 min", text)
        self.assertIn("| `refresh_explore_filter_options` | ok | 1 | 12.3 s |", text)
        self.assertIn("failed (nonfatal): 57014: timeout | 3 |", text)

    def test_reason_with_pipes_and_newlines_stays_in_one_table_cell(self):
        text = push.format_push_summary(
            {}, None, 1.0,
            {"refresh_explore_filter_options": {"status": "failed", "attempts": 1, "reason": "a | b\nc"}},
        )
        self.assertIn("| failed: a \\| b c | 1 |", text)

    def test_summary_marks_unfinished_publication_and_unrun_maintenance(self):
        text = push.format_push_summary({}, None, None, {})
        self.assertIn("Publication: **did not finish**", text)
        self.assertIn("| `refresh_explore_filter_options` | not run |", text)

    def test_summary_never_contains_the_service_key_or_url(self):
        secret = "eyJhbGciOiJIUzI1NiJ9.service.secret"
        url = "https://project-ref.supabase.co"
        with patch.dict("os.environ", {"SUPABASE_SERVICE_KEY": secret, "SUPABASE_URL": url}):
            client = _ScriptedRpcClient(
                {"refresh_explore_filter_options": [_timeout() for _ in range(push.MAINTENANCE_MAX_ATTEMPTS)]}
            )
            report = {}
            with patch.object(push.time, "sleep"), patch("builtins.print"):
                with self.assertRaises(push.MaintenanceRpcError):
                    push.refresh_post_push_data(client, report)
            text = push.format_push_summary({"sets (TCG)": 1}, None, 1.0, report)
        self.assertNotIn(secret, text)
        self.assertNotIn(url, text)

    def test_write_step_summary_appends_only_in_ci(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "summary.md"
            with patch.dict("os.environ", {"GITHUB_STEP_SUMMARY": str(path)}):
                push.write_step_summary("one\n")
                push.write_step_summary("two\n")
            self.assertEqual(path.read_text(), "one\ntwo\n")
        with patch.dict("os.environ", {}, clear=True):
            push.write_step_summary("ignored")  # no env var: no-op, no error


def _card(card_id, origin="pokemontcg.io", name="Pikachu", **extra):
    return {"id": card_id, "name": name, "origin": origin, "last_seen_in_api": "run-1", **extra}


class ApiHashTests(unittest.TestCase):
    def test_ignores_observation_stamp_and_key_order(self):
        a = {"id": "x", "name": "A", "raw_data": {"b": 1, "a": [1.5, "ポ"]}, "last_seen_in_api": "t1"}
        b = {"last_seen_in_api": "t2", "raw_data": {"a": [1.5, "ポ"], "b": 1}, "name": "A", "id": "x"}
        self.assertEqual(push.api_hash(a), push.api_hash(b))

    def test_changes_with_content(self):
        self.assertNotEqual(push.api_hash(_card("x")), push.api_hash(_card("x", name="Raichu")))
        self.assertNotEqual(push.api_hash(_card("x")), push.api_hash(_card("x", prices={"usd": 1.0})))


class PublishGateTests(unittest.TestCase):
    def test_card_owned_by_another_origin_is_skipped_and_reported(self):
        gate = push.PublishGate({"xyp-JP279": ("manual", None)}, hashes=True)
        out = gate.filter_cards("cards (pokemontcg.io)", [_card("xyp-JP279"), _card("sv1-1")])
        self.assertEqual([r["id"] for r in out], ["sv1-1"])
        self.assertEqual(gate.collisions, {"cards (pokemontcg.io)": ["xyp-JP279"]})

    def test_unchanged_cards_are_skipped_and_changed_or_new_cards_carry_the_hash(self):
        same, changed = _card("a"), _card("b", name="New name")
        gate = push.PublishGate(
            {"a": ("pokemontcg.io", push.api_hash(same)), "b": ("pokemontcg.io", "old-hash")}, hashes=True
        )
        out = gate.filter_cards("cards (pokemontcg.io)", [{**same, "last_seen_in_api": "run-2"}, changed, _card("c")])
        self.assertEqual([r["id"] for r in out], ["b", "c"])
        self.assertEqual(out[0]["api_hash"], push.api_hash(changed))
        self.assertEqual(gate.unchanged, {"cards (pokemontcg.io)": 1})

    def test_rows_without_a_stored_hash_are_published(self):
        gate = push.PublishGate({"a": ("pokemontcg.io", None)}, hashes=True)
        self.assertEqual(len(gate.filter_cards("cards", [_card("a")])), 1)

    def test_without_the_hash_column_every_row_is_published_without_api_hash(self):
        row = _card("a")
        gate = push.PublishGate({"a": ("pokemontcg.io", push.api_hash(row))}, hashes=False)
        out = gate.filter_cards("cards", [row])
        self.assertEqual(out, [row])
        self.assertEqual(gate.unchanged, {})

    def test_ids_published_earlier_in_the_run_are_claimed(self):
        gate = push.PublishGate(hashes=True)
        gate.filter_cards("cards (pokemontcg.io)", [_card("neo4-100")])
        out = gate.filter_cards("cards (tcgdex Japanese)", [_card("neo4-100", origin="tcgdex")])
        self.assertEqual(out, [])
        self.assertEqual(gate.collisions, {"cards (tcgdex Japanese)": ["neo4-100"]})

    def test_set_owned_by_another_origin_is_skipped(self):
        gate = push.PublishGate(sets={"neo1": "tcgdex"})
        rows = [{"id": "neo1", "origin": "pokemontcg.io"}, {"id": "base1", "origin": "pokemontcg.io"}]
        self.assertEqual([r["id"] for r in gate.filter_sets("sets (TCG)", rows)], ["base1"])
        self.assertEqual(gate.collisions, {"sets (TCG)": ["neo1"]})

    def test_empty_gate_publishes_everything(self):
        gate = push.PublishGate()
        self.assertEqual(len(gate.filter_cards("cards", [_card("a"), _card("b")])), 2)
        self.assertEqual((gate.collisions, gate.unchanged), ({}, {}))


class FetchPublishGateTests(unittest.TestCase):
    def test_reads_ownership_and_hashes(self):
        client = _PagedRowsClient(
            {
                "cards": [{"id": "a", "origin": "manual", "api_hash": None}, {"id": "b", "origin": "tcgdex", "api_hash": "h"}],
                "sets": [{"id": "neo1", "origin": "tcgdex"}],
            }
        )
        with patch("builtins.print"):
            gate = push.fetch_publish_gate(client)
        self.assertTrue(gate.hashes)
        self.assertEqual(gate.cards, {"a": ("manual", None), "b": ("tcgdex", "h")})
        self.assertEqual(gate.sets, {"neo1": "tcgdex"})

    def test_falls_back_to_ownership_only_before_the_migration(self):
        client = _PagedRowsClient(
            {"cards": [{"id": "a", "origin": "manual"}], "sets": []}, missing_columns={"api_hash"}
        )
        with patch("builtins.print") as printed:
            gate = push.fetch_publish_gate(client)
        self.assertFalse(gate.hashes)
        self.assertEqual(gate.cards, {"a": ("manual", None)})
        self.assertTrue(any("api_hash not found" in str(c.args[0]) for c in printed.call_args_list))

    def test_other_read_errors_are_fatal(self):
        client = _PagedRowsClient({"cards": [], "sets": []}, missing_columns={"origin"})
        with patch("builtins.print"), self.assertRaises(APIError):
            push.fetch_publish_gate(client)

    def test_dry_run_gate_is_empty(self):
        with patch("builtins.print"):
            gate = push.fetch_publish_gate(None)
        self.assertEqual((gate.cards, gate.sets, gate.hashes), ({}, {}, False))


class JapaneseSetNamespaceTests(unittest.TestCase):
    def _db(self, tmp):
        conn = _tcgdex_japanese_db(
            tmp,
            [("neo4-100", "neo4", 100, False), ("neo4-001", "neo4", 1, False), ("SV4a-005", "SV4a", 5, False)],
        )
        conn.close()
        path = str(Path(tmp) / "japanese.duckdb")
        rw = duckdb.connect(path)
        try:
            rw.execute("CREATE TABLE sets (id VARCHAR PRIMARY KEY, name VARCHAR)")
            rw.execute("INSERT INTO sets VALUES ('neo4', 'Neo Destiny'), ('sv4', 'Paradox Rift')")
            rw.execute("INSERT INTO japanese_sets VALUES ('neo4', '闇、そして光へ...'), ('SV4a', 'シャイニートレジャーex')")
        finally:
            rw.close()
        return duckdb.connect(path, read_only=True)

    def test_only_sets_sharing_an_english_id_are_prefixed(self):
        with tempfile.TemporaryDirectory() as tmp:
            conn = self._db(tmp)
            try:
                self.assertEqual(push.japanese_set_id_map(conn), {"neo4": "ja-neo4"})
            finally:
                conn.close()

    def test_cards_and_sets_in_prefixed_sets_get_ja_ids(self):
        with tempfile.TemporaryDirectory() as tmp:
            conn = self._db(tmp)
            client = _FakeClient(max_rows=1000)
            captured = []
            original = push.batch_upsert
            try:
                with patch.object(push, "batch_upsert", side_effect=lambda sb, t, rows: captured.append((t, rows)) or original(sb, t, rows)):
                    set_map = push.japanese_set_id_map(conn)
                    gate = push.PublishGate({"neo4-100": ("pokemontcg.io", "h")}, {"neo4": "pokemontcg.io"}, hashes=True)
                    push.push_japanese_sets(conn, client, gate, set_map)
                    published, skipped = push.push_japanese_cards(conn, client, "now", set(), gate, set_map)
            finally:
                conn.close()

        sets_rows = dict(captured)["sets"]
        cards_rows = dict(captured)["cards"]
        self.assertEqual(sorted(r["id"] for r in sets_rows), ["SV4a", "ja-neo4"])
        self.assertEqual(sorted(r["id"] for r in cards_rows), ["SV4a-005", "ja-neo4-001", "ja-neo4-100"])
        self.assertEqual({r["set_id"] for r in cards_rows if r["id"].startswith("ja-")}, {"ja-neo4"})
        self.assertEqual({r["set_name"] for r in cards_rows if r["id"].startswith("ja-")}, {"闇、そして光へ..."})
        self.assertEqual((published, skipped), (3, 0))
        self.assertEqual(gate.collisions, {})  # the English neo4 rows are left alone

    def test_twin_check_uses_the_upstream_set_id(self):
        with tempfile.TemporaryDirectory() as tmp:
            conn = self._db(tmp)
            try:
                published, skipped = push.push_japanese_cards(
                    conn, _FakeClient(max_rows=1000), "now", {"ptcgdb-neo4-100"}, None, push.japanese_set_id_map(conn)
                )
            finally:
                conn.close()
        self.assertEqual((published, skipped), (2, 1))


class GateSummaryTests(unittest.TestCase):
    def test_summary_lists_unchanged_rows_and_collisions(self):
        gate = push.PublishGate(hashes=True)
        gate.unchanged = {"cards (pokemontcg.io)": 20656}
        gate.collisions = {"cards (pokemontcg.io)": [f"neo4-{n}" for n in range(100, 125)]}
        text = push.format_push_summary({"cards (pokemontcg.io)": 0}, None, 30.0, {}, gate)
        self.assertIn("Card fingerprints: on", text)
        self.assertIn("| cards (pokemontcg.io) unchanged (skipped) | 20,656 |", text)
        self.assertIn("- cards (pokemontcg.io): 25 — `neo4-100`", text)
        self.assertIn("(+5 more)", text)

    def test_summary_flags_missing_fingerprint_column(self):
        text = push.format_push_summary({}, None, 30.0, {}, push.PublishGate(hashes=False))
        self.assertIn("Card fingerprints: **off**", text)

    def test_collisions_are_logged_as_a_ci_warning(self):
        gate = push.PublishGate()
        gate.collisions = {"sets (TCG)": ["neo1", "neo2"]}
        with patch("builtins.print") as printed:
            push.report_collisions(gate)
        line = printed.call_args.args[0]
        self.assertTrue(line.startswith("::warning title=ID collision (sets (TCG))::2 row(s)"))
        self.assertIn("neo1, neo2", line)


class _PartitionRpcClient:
    """RPC client returning ``data`` (or raising ``error``) for every call."""

    def __init__(self, data=None, error=None):
        self.data = data
        self.error = error
        self.calls = []

    def rpc(self, function_name, params):
        self.calls.append((function_name, params))
        client = self

        class Request:
            def execute(self_inner):
                if client.error is not None:
                    raise client.error

                class Result:
                    data = client.data

                return Result()

        return Request()


class EditHistoryPartitionTests(unittest.TestCase):
    def _run(self, client):
        report = {}
        with patch("builtins.print") as printed:
            data = push.ensure_edit_history_partitions(client, report)
        lines = [str(c.args[0]) for c in printed.call_args_list if c.args]
        return data, report, lines

    def test_requests_four_quarters_ahead_and_records_the_horizon(self):
        client = _PartitionRpcClient(
            {"created": ["edit_history_2027_q3"], "horizon": "2027-10-01", "future_quarters": 4}
        )
        data, report, lines = self._run(client)
        self.assertEqual(client.calls, [("ensure_edit_history_partitions", {"p_quarters_ahead": 4})])
        self.assertEqual(data["future_quarters"], 4)
        step = report["ensure_edit_history_partitions"]
        self.assertEqual(step["status"], "ok: 4 future quarter(s), through 2027-10-01; created edit_history_2027_q3")
        self.assertIn("seconds", step)
        self.assertFalse(any(line.startswith("::warning") for line in lines))

    def test_warns_when_fewer_than_two_future_quarters_remain(self):
        client = _PartitionRpcClient({"created": [], "horizon": "2027-01-01", "future_quarters": 1})
        _, report, lines = self._run(client)
        self.assertTrue(report["ensure_edit_history_partitions"]["status"].startswith("ok: 1 future"))
        self.assertTrue(any(line.startswith("::warning title=edit_history partitions running out::") for line in lines))

    def test_rpc_failure_is_nonfatal_and_reported(self):
        client = _PartitionRpcClient(
            error=APIError({"code": "PGRST202", "message": "Could not find the function"})
        )
        data, report, lines = self._run(client)
        self.assertIsNone(data)
        step = report["ensure_edit_history_partitions"]
        self.assertEqual(step["status"], "failed (nonfatal)")
        self.assertIn("PGRST202", step["reason"])
        self.assertTrue(any(line.startswith("::warning title=edit_history partition check failed") for line in lines))

    def test_summary_lists_the_partition_check(self):
        text = push.format_push_summary(
            {}, None, 1.0,
            {"ensure_edit_history_partitions": {"status": "ok: 8 future quarter(s), through 2028-10-01", "attempts": 1, "seconds": 0.2}},
        )
        self.assertIn("| `ensure_edit_history_partitions` | ok: 8 future quarter(s), through 2028-10-01 | 1 | 0.2 s |", text)
        self.assertIn("| `refresh_explore_filter_options` | not run |", push.format_push_summary({}, None, None, {}))


if __name__ == "__main__":
    unittest.main()
