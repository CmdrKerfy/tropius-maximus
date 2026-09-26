#!/usr/bin/env python3
"""Focused tests for adaptive Supabase ingest batching."""

import unittest
from unittest.mock import patch

import push_duckdb_to_supabase as push


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


if __name__ == "__main__":
    unittest.main()
