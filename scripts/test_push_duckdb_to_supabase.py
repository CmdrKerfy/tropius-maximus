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


class _PagedIdClient:
    """Serves ``ids`` in sorted pages and records each query's filters."""

    def __init__(self, ids):
        self.ids = sorted(ids)
        self.queries = []

    def table(self, name):
        client = self

        class Query:
            def __init__(self):
                self.filters = {"table": name}

            def select(self, cols):
                self.filters["select"] = cols
                return self

            def eq(self, col, value):
                self.filters[f"eq:{col}"] = value
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
                after = self.filters.get("gt:id")
                rows = [i for i in client.ids if after is None or i > after][: self.filters["limit"]]
                return type("Response", (), {"data": [{"id": i} for i in rows]})()

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

    def test_published_ids_are_keyset_paged(self):
        ids = [f"ptcgdb-s-{i:04d}" for i in range(5)]
        client = _PagedIdClient(ids)
        with patch.object(push, "PTCGDB_ID_PAGE_SIZE", 2):
            result = push.fetch_published_ptcgdb_ids(client)

        self.assertEqual(result, set(ids))
        self.assertEqual([q.get("gt:id") for q in client.queries], [None, ids[1], ids[3]])
        self.assertTrue(all(q["eq:origin"] == "ptcgdb" and q["select"] == "id" for q in client.queries))

    def test_exact_page_multiple_ends_on_empty_page(self):
        client = _PagedIdClient(["a", "b"])
        with patch.object(push, "PTCGDB_ID_PAGE_SIZE", 2):
            self.assertEqual(push.fetch_published_ptcgdb_ids(client), {"a", "b"})
        self.assertEqual(len(client.queries), 2)

    def test_dry_run_has_no_published_ids(self):
        self.assertEqual(push.fetch_published_ptcgdb_ids(None), set())

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


if __name__ == "__main__":
    unittest.main()
