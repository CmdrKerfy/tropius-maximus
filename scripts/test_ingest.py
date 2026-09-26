#!/usr/bin/env python3
"""Focused tests for ingest database lifecycle helpers."""

import io
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

import duckdb
import httpx

import ingest


class ClearFailedSetsTests(unittest.TestCase):
    def test_fresh_database_creates_table_before_cleanup(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = str(Path(tmp) / "fresh.duckdb")
            with patch.object(ingest, "DB_PATH", db_path):
                self.assertEqual(ingest.clear_failed_sets(), 0)
                conn = duckdb.connect(db_path, read_only=True)
                try:
                    tables = {
                        row[0]
                        for row in conn.execute(
                            "SELECT table_name FROM information_schema.tables"
                        ).fetchall()
                    }
                finally:
                    conn.close()
                self.assertIn("failed_sets", tables)

    def test_existing_failure_rows_are_counted_and_deleted(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = str(Path(tmp) / "existing.duckdb")
            with patch.object(ingest, "DB_PATH", db_path):
                ingest.initialize_database()
                conn = duckdb.connect(db_path)
                try:
                    conn.execute(
                        "INSERT INTO failed_sets (set_id, reason) VALUES (?, ?)",
                        ["test-set", "404"],
                    )
                finally:
                    conn.close()

                self.assertEqual(ingest.clear_failed_sets(), 1)

                conn = duckdb.connect(db_path, read_only=True)
                try:
                    remaining = conn.execute(
                        "SELECT COUNT(*) FROM failed_sets"
                    ).fetchone()[0]
                finally:
                    conn.close()
                self.assertEqual(remaining, 0)


def _card(card_id):
    return {"id": card_id, "name": card_id}


def _http_status_error(status_code):
    request = httpx.Request("GET", "https://example.test/cards")
    response = httpx.Response(status_code, request=request)
    return httpx.HTTPStatusError(
        f"HTTP {status_code}", request=request, response=response
    )


class ResumableCardIngestTests(unittest.TestCase):
    def test_transient_failure_is_retried_in_second_pass(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = str(Path(tmp) / "retry.duckdb")
            calls = {"set-a": 0, "set-b": 0}

            def fetch(sid):
                calls[sid] += 1
                if sid == "set-a" and calls[sid] == 1:
                    raise _http_status_error(502)
                return [_card(f"{sid}-1")]

            with (
                patch.object(ingest, "DB_PATH", db_path),
                patch.object(ingest, "get_set_file_list", return_value=["set-a", "set-b"]),
                patch.object(ingest, "fetch_cards_from_api", side_effect=fetch),
                patch.object(ingest.time, "sleep", return_value=None),
            ):
                ingest.initialize_database()
                total, failures = ingest.ingest_cards(
                    {"set-a": {"total": 1}, "set-b": {"total": 1}}
                )

            self.assertEqual((total, failures), (2, 0))
            self.assertEqual(calls, {"set-a": 2, "set-b": 1})

    def test_cached_complete_set_is_not_downloaded_again(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = str(Path(tmp) / "resume.duckdb")
            with patch.object(ingest, "DB_PATH", db_path):
                ingest.initialize_database()
                conn = duckdb.connect(db_path)
                try:
                    ingest._store_tcg_cards(
                        conn, "set-a", [_card("set-a-1")], {"name": "Set A"}
                    )
                finally:
                    conn.close()

                with (
                    patch.object(ingest, "get_set_file_list", return_value=["set-a"]),
                    patch.object(ingest, "fetch_cards_from_api") as fetch,
                ):
                    total, failures = ingest.ingest_cards({"set-a": {"total": 1}})

            self.assertEqual((total, failures), (0, 0))
            fetch.assert_not_called()

    def test_rate_limit_response_is_treated_as_transient(self):
        self.assertTrue(ingest._is_transient_http_status(429))
        self.assertFalse(ingest._is_transient_http_status(404))

    def test_unresolved_transient_failure_is_reported_after_retry_pass(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = str(Path(tmp) / "unresolved.duckdb")
            with (
                patch.object(ingest, "DB_PATH", db_path),
                patch.object(ingest, "get_set_file_list", return_value=["set-a"]),
                patch.object(
                    ingest,
                    "fetch_cards_from_api",
                    side_effect=_http_status_error(500),
                ) as fetch,
                patch.object(ingest.time, "sleep", return_value=None),
            ):
                ingest.initialize_database()
                total, failures = ingest.ingest_cards({"set-a": {"total": 1}})

            self.assertEqual((total, failures), (0, 1))
            self.assertEqual(fetch.call_count, 2)

    def test_empty_database_file_without_tables(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = str(Path(tmp) / "empty.duckdb")
            duckdb.connect(db_path).close()
            with patch.object(ingest, "DB_PATH", db_path):
                self.assertEqual(ingest.clear_failed_sets(), 0)

    def test_older_database_missing_failed_sets(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = str(Path(tmp) / "older.duckdb")
            conn = duckdb.connect(db_path)
            try:
                conn.execute("CREATE TABLE tcg_cards (id VARCHAR PRIMARY KEY)")
                conn.execute("INSERT INTO tcg_cards VALUES ('keep-me')")
            finally:
                conn.close()
            with patch.object(ingest, "DB_PATH", db_path):
                self.assertEqual(ingest.clear_failed_sets(), 0)
            conn = duckdb.connect(db_path, read_only=True)
            try:
                kept = conn.execute("SELECT COUNT(*) FROM tcg_cards").fetchone()[0]
            finally:
                conn.close()
            self.assertEqual(kept, 1)


def _network_forbidden(*_args, **_kwargs):
    raise AssertionError("network access attempted during offline ingest test")


class _JsonResponse:
    def __init__(self, data):
        self._data = data

    def raise_for_status(self):
        return None

    def json(self):
        return self._data


def _tcgdex_card(card_id):
    return {
        "id": card_id,
        "name": card_id,
        "localId": "001",
        "image": "https://assets.example.test/card",
    }


class IncrementalTcgdexIngestTests(unittest.TestCase):
    def test_pocket_downloads_only_cards_missing_from_each_set(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = str(Path(tmp) / "pocket.duckdb")
            card_requests = []

            def get(url, **_kwargs):
                if url.endswith("/series/tcgp"):
                    return _JsonResponse({"sets": [{"id": "complete"}, {"id": "new"}]})
                if url.endswith("/sets/complete"):
                    return _JsonResponse({"serie": {"id": "tcgp"}, "cards": [{"id": "complete-1"}]})
                if url.endswith("/sets/new"):
                    return _JsonResponse({"serie": {"id": "tcgp"}, "cards": [{"id": "new-1"}]})
                if "/cards/" in url:
                    card_id = url.rsplit("/", 1)[-1]
                    card_requests.append(card_id)
                    return _JsonResponse(_tcgdex_card(card_id))
                raise AssertionError(f"unexpected URL: {url}")

            with patch.object(ingest, "DB_PATH", db_path):
                ingest.initialize_database()
                conn = duckdb.connect(db_path)
                try:
                    conn.execute(
                        "INSERT INTO pocket_cards (id, set_id) VALUES (?, ?)",
                        ["complete-1", "complete"],
                    )
                finally:
                    conn.close()

                with patch.object(ingest.httpx, "get", side_effect=get), \
                        patch.object(ingest.time, "sleep", return_value=None):
                    result = ingest.ingest_pocket_cards()

                conn = duckdb.connect(db_path, read_only=True)
                try:
                    count = conn.execute("SELECT COUNT(*) FROM pocket_cards").fetchone()[0]
                finally:
                    conn.close()

            self.assertEqual(result, (1, 0, 0))
            self.assertEqual(card_requests, ["new-1"])
            self.assertEqual(count, 2)

    def test_japanese_resumes_an_incomplete_set_at_card_level(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = str(Path(tmp) / "japanese.duckdb")
            card_requests = []

            def get(url, **_kwargs):
                if url.endswith("/sets"):
                    return _JsonResponse([{"id": "jp-set"}])
                if url.endswith("/sets/jp-set"):
                    return _JsonResponse(
                        {
                            "serie": {"id": "JP"},
                            "cards": [{"id": "jp-1"}, {"id": "jp-2"}],
                        }
                    )
                if "/cards/" in url:
                    card_id = url.rsplit("/", 1)[-1]
                    card_requests.append(card_id)
                    return _JsonResponse(_tcgdex_card(card_id))
                raise AssertionError(f"unexpected URL: {url}")

            with patch.object(ingest, "DB_PATH", db_path):
                ingest.initialize_database()
                conn = duckdb.connect(db_path)
                try:
                    conn.execute(
                        "INSERT INTO japanese_cards (id, set_id) VALUES (?, ?)",
                        ["jp-1", "jp-set"],
                    )
                finally:
                    conn.close()

                with patch.object(ingest.httpx, "get", side_effect=get), \
                        patch.object(ingest.time, "sleep", return_value=None):
                    result = ingest.ingest_japanese_cards()

                conn = duckdb.connect(db_path, read_only=True)
                try:
                    count = conn.execute("SELECT COUNT(*) FROM japanese_cards").fetchone()[0]
                finally:
                    conn.close()

            self.assertEqual(result, (1, 0, 0))
            self.assertEqual(card_requests, ["jp-2"])
            self.assertEqual(count, 2)


class ClearFailedCliTests(unittest.TestCase):
    def test_cli_clear_failed_on_nonexistent_path_runs_offline(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = str(Path(tmp) / "missing-dir" / "pokemon.duckdb")
            argv = [
                "ingest.py",
                "--clear-failed",
                "--fail-on-partial",
                "--skip-pokemon",
                "--skip-tcg",
                "--skip-pocket",
                "--skip-japanese",
            ]
            with patch.object(ingest, "DB_PATH", db_path), \
                    patch.object(sys, "argv", argv), \
                    patch.object(ingest.httpx, "get", _network_forbidden), \
                    patch.object(ingest.httpx, "head", _network_forbidden), \
                    patch.object(ingest.httpx, "Client", _network_forbidden), \
                    redirect_stdout(io.StringIO()) as out:
                ingest.main()

            self.assertIn("Cleared 0 permanently-failed set(s)", out.getvalue())
            conn = duckdb.connect(db_path, read_only=True)
            try:
                tables = {
                    row[0]
                    for row in conn.execute(
                        "SELECT table_name FROM information_schema.tables"
                    ).fetchall()
                }
            finally:
                conn.close()
            self.assertTrue({"failed_sets", "tcg_cards", "sets"} <= tables)


class StepSummaryTests(unittest.TestCase):
    def test_cli_writes_counts_and_outcome_to_step_summary(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = str(Path(tmp) / "summary.duckdb")
            summary_path = Path(tmp) / "summary.md"
            argv = [
                "ingest.py",
                "--skip-pokemon",
                "--skip-tcg",
                "--skip-pocket",
                "--skip-japanese",
            ]
            with patch.object(ingest, "DB_PATH", db_path), \
                    patch.object(sys, "argv", argv), \
                    patch.dict("os.environ", {"GITHUB_STEP_SUMMARY": str(summary_path)}), \
                    patch.object(ingest.httpx, "get", _network_forbidden), \
                    redirect_stdout(io.StringIO()):
                ingest.main()

            text = summary_path.read_text()
        self.assertIn("Result: **complete**", text)
        self.assertIn("| `tcg_cards` | 0 |", text)
        self.assertIn("| `japanese_cards_ptcgdb` | 0 |", text)
        self.assertNotIn("Failure counter", text)

    def test_summary_reports_partial_failures(self):
        stats = ingest.IngestFailureSummary(pocket_card_fetch_failures=2)
        text = ingest.format_ingest_summary(stats, {"pocket_cards": 2349}, 125.0)
        self.assertIn("Result: **partial API failures**", text)
        self.assertIn("Duration: 2.1 min", text)
        self.assertIn("| `pocket_cards` | 2,349 |", text)
        self.assertIn("| `pocket_card_fetch_failures` | 2 |", text)

    def test_counts_skip_tables_that_do_not_exist(self):
        conn = duckdb.connect(":memory:")
        try:
            conn.execute("CREATE TABLE tcg_cards (id VARCHAR)")
            conn.execute("INSERT INTO tcg_cards VALUES ('a'), ('b')")
            self.assertEqual(ingest.source_row_counts(conn), {"tcg_cards": 2})
        finally:
            conn.close()


if __name__ == "__main__":
    unittest.main()
