#!/usr/bin/env python3
"""Split a multi-chunk SQL file into individual files and run each via supabase CLI."""
import argparse
import os
import re
import subprocess
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Split and execute chunked SQL via Supabase CLI.")
    parser.add_argument("file", type=str, help="Path to chunked SQL file.")
    return parser.parse_args()


def split_into_chunks(sql_text: str) -> list[str]:
    # Split on blocks that start with begin; and end with commit;
    pattern = r"begin;.*?commit;"
    chunks = re.findall(pattern, sql_text, re.DOTALL | re.IGNORECASE)
    return [c.strip() for c in chunks if c.strip()]


def main() -> int:
    args = parse_args()
    sql_path = Path(args.file)
    if not sql_path.exists():
        print(f"ERROR: File not found: {sql_path}", file=sys.stderr)
        return 1

    sql = sql_path.read_text(encoding="utf-8")
    chunks = split_into_chunks(sql)
    if not chunks:
        print("ERROR: No begin...commit blocks found.", file=sys.stderr)
        return 1

    print(f"Found {len(chunks)} chunk(s). Executing one at a time via 'supabase db query --linked'...")

    for i, chunk in enumerate(chunks, start=1):
        chunk_path = sql_path.with_suffix(f".chunk{i}.sql")
        chunk_path.write_text(chunk, encoding="utf-8")
        print(f"\n--- Chunk {i}/{len(chunks)} ({len(chunk)} chars) ---")

        result = subprocess.run(
            ["supabase", "db", "query", "-f", str(chunk_path), "--linked"],
            capture_output=True,
            text=True,
        )
        print(result.stdout)
        if result.returncode != 0:
            print(f"ERROR on chunk {i}:\n{result.stderr}", file=sys.stderr)
            return 1

    print(f"\nAll {len(chunks)} chunk(s) executed successfully.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
