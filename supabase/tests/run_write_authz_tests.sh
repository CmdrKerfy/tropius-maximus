#!/usr/bin/env bash
# Phase 2B/2D write-authorization tests on a throwaway local Postgres.
# Never touches Supabase. Needs initdb/pg_ctl/psql on PATH (or PG_BIN).
#
#   supabase/tests/run_write_authz_tests.sh
#
# Database 1: fixture -> phase=before (documents the production holes)
#             -> 2B migration -> 2D migration -> phase=after
# Database 2: fixture -> 2D migration -> 2B migration -> phase=after
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PG_BIN="${PG_BIN:-$(dirname "$(command -v initdb || echo /opt/homebrew/opt/postgresql@18/bin/initdb)")}"
PORT="${PORT:-54329}"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/write-authz.XXXXXX")"
# Unix socket paths are limited to ~100 bytes, so the socket gets a short dir.
SOCK="$(mktemp -d /tmp/wa.XXXXXX)"

cleanup() {
  "$PG_BIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$TMP" "$SOCK"
}
trap cleanup EXIT

"$PG_BIN/initdb" -D "$TMP/data" -A trust -U postgres >/dev/null
"$PG_BIN/pg_ctl" -D "$TMP/data" -l "$TMP/log" -o "-k $SOCK -p $PORT -c listen_addresses=''" -w start >/dev/null

psql_db() {
  local db="$1"; shift
  "$PG_BIN/psql" -X -q -h "$SOCK" -p "$PORT" -U postgres -d "$db" -v ON_ERROR_STOP=1 "$@"
}

FIXTURE="$HERE/fixtures/prod_shape_write_authz.sql"
LIB="$HERE/write_authz_lib.sql"
TESTS="$HERE/write_authz.test.sql"
D2B="$ROOT/supabase/migrations/20260927225104_restrict_card_writes.sql"
D2D="$ROOT/supabase/migrations/20260927225105_server_authoritative_audit.sql"

for db in authz_a authz_b; do
  psql_db postgres -c "CREATE DATABASE $db"
  psql_db "$db" -f "$FIXTURE" -f "$LIB"
done

echo "== authz_a: before (production policies) =="
psql_db authz_a -v phase=before -f "$TESTS"
psql_db authz_a -f "$D2B" -f "$D2D"
echo "== authz_a: after (2B then 2D) =="
psql_db authz_a -v phase=after -f "$TESTS"

psql_db authz_b -f "$D2D" -f "$D2B"
echo "== authz_b: after (2D then 2B) =="
psql_db authz_b -v phase=after -f "$TESTS"

echo "All write-authz phases passed."
