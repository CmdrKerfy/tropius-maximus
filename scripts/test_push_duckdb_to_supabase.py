#!/usr/bin/env python3
"""Focused tests for adaptive Supabase ingest batching and post-push maintenance."""

import json
import unittest
from unittest.mock import patch

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
        self.assertEqual([c.args[0] for c in sleep.call_args_list], list(push.MAINTENANCE_BACKOFF_SECONDS))
        self.assertTrue(any("attempts: 3" in line for line in printed))

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


if __name__ == "__main__":
    unittest.main()
