#!/usr/bin/env python3
"""Execute a SQL file against Supabase via PostgREST exec_sql RPC or direct REST.

Requires: SUPABASE_URL, SUPABASE_SERVICE_KEY (env vars).
"""
import argparse
import os
import sys

import httpx


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Execute a SQL file against Supabase.")
    parser.add_argument("file", type=str, help="Path to SQL file to execute.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.", file=sys.stderr)
        return 1

    sql_path = args.file
    if not os.path.exists(sql_path):
        print(f"ERROR: File not found: {sql_path}", file=sys.stderr)
        return 1

    sql = open(sql_path, encoding="utf-8").read()

    # Try exec_sql RPC first (if it exists on the project)
    rpc_url = f"{url}/rest/v1/rpc/exec_sql"
    try:
        r = httpx.post(
            rpc_url,
            headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={"sql": sql},
            timeout=120,
        )
        if r.status_code == 404:
            raise RuntimeError("exec_sql RPC not found")
        r.raise_for_status()
        print(f"Executed via RPC: {sql_path}")
        return 0
    except Exception as rpc_exc:
        print(f"RPC failed ({rpc_exc}), falling back to direct postgres...", file=sys.stderr)

    # Fallback: pgBouncer direct connection (requires additional env vars)
    pg_password = os.environ.get("SUPABASE_DB_PASSWORD")
    pg_host = os.environ.get("SUPABASE_DB_HOST")
    if not pg_password or not pg_host:
        print(
            "ERROR: Direct postgres fallback requires SUPABASE_DB_PASSWORD and SUPABASE_DB_HOST.",
            file=sys.stderr,
        )
        print("Alternative: run chunks manually in Supabase SQL Editor.", file=sys.stderr)
        return 1

    try:
        import psycopg2  # type: ignore[import-untyped]
    except ImportError:
        print("ERROR: psycopg2 not installed. Run: pip install psycopg2-binary", file=sys.stderr)
        return 1

    conn = psycopg2.connect(
        host=pg_host,
        port=5432,
        dbname="postgres",
        user="postgres",
        password=pg_password,
        sslmode="require",
    )
    cur = conn.cursor()
    try:
        cur.execute(sql)
        conn.commit()
        print(f"Executed via direct postgres: {sql_path}")
    except Exception as exc:
        conn.rollback()
        print(f"ERROR executing SQL: {exc}", file=sys.stderr)
        return 1
    finally:
        cur.close()
        conn.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
