#!/usr/bin/env python3
"""Focused tests for ingest database lifecycle helpers."""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import duckdb

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


if __name__ == "__main__":
    unittest.main()
