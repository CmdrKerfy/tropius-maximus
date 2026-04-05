"""
Export DuckDB tables to Parquet files for the static site.

Reads public/data/pokemon.duckdb and writes Parquet files. Before exporting,
automatically normalizes Pokémon supertype variants in tcg_cards to 'Pokémon'.

Usage:
    python export_parquet.py
"""

import os
import re
import sys
import unicodedata
import duckdb

# Refuse to ship cards.parquet if the API-sourced catalog looks truncated (CI safety).
MIN_NON_CUSTOM_TCG_CARDS = 10_000

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(SCRIPT_DIR, "..", "public", "data", "pokemon.duckdb")
OUTPUT_DIR = os.path.join(SCRIPT_DIR, "..", "public", "data")


def _normalize_supertype(s: str) -> str:
    """Return 'Pokémon' for any Pokémon variant (including mojibake), else unchanged."""
    if not s or not isinstance(s, str):
        return s or ""
    norm = unicodedata.normalize("NFD", s)
    norm = re.sub(r"[\u0300-\u036f]", "", norm).lower()
    if norm == "pokemon":
        return "Pokémon"
    alpha_only = re.sub(r"[^a-zA-Z]", "", s).lower()
    if alpha_only in ("pokemon", "pokmon"):
        return "Pokémon"
    return s


def _normalize_supertypes_in_db(conn: duckdb.DuckDBPyConnection) -> int:
    """Set supertype = 'Pokémon' for every tcg_cards row whose supertype is a variant. Returns count of variants fixed."""
    try:
        rows = conn.execute(
            "SELECT DISTINCT supertype FROM tcg_cards WHERE supertype IS NOT NULL AND supertype != ''"
        ).fetchall()
    except Exception:
        return 0
    n = 0
    for (val,) in rows:
        if val == "Pokémon":
            continue
        if _normalize_supertype(val) == "Pokémon":
            conn.execute(
                "UPDATE tcg_cards SET supertype = 'Pokémon' WHERE supertype = ?", [val]
            )
            n += 1
    return n


def safe_export(conn, table, query, output_path, label):
    """Export a table to parquet, but skip if the table is empty or missing."""
    try:
        count = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        if count == 0:
            print(f"  {label}: SKIPPED (table is empty, refusing to overwrite)")
            return
        conn.execute(f"""
            COPY ({query})
            TO '{output_path}'
            (FORMAT PARQUET, COMPRESSION ZSTD)
        """)
        size = os.path.getsize(output_path)
        if size > 1024 * 1024:
            print(f"  {label}: {size / 1024 / 1024:.1f} MB ({count} rows)")
        else:
            print(f"  {label}: {size / 1024:.0f} KB ({count} rows)")
    except Exception as e:
        print(f"  {label}: skipped ({e})")


def export():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    conn = duckdb.connect(DB_PATH)  # read-write so we can normalize before export
    fixed = _normalize_supertypes_in_db(conn)
    if fixed:
        print(f"  Normalized {fixed} supertype variant(s) to 'Pokémon'.")

    tcg_api_count = conn.execute(
        "SELECT COUNT(*) FROM tcg_cards WHERE NOT is_custom"
    ).fetchone()[0]
    if tcg_api_count < MIN_NON_CUSTOM_TCG_CARDS:
        print(
            f"  cards.parquet: ABORT — only {tcg_api_count} non-custom tcg_cards "
            f"(minimum {MIN_NON_CUSTOM_TCG_CARDS}). Refusing to overwrite export.",
            file=sys.stderr,
        )
        conn.close()
        sys.exit(1)

    safe_export(conn, "tcg_cards",
                "SELECT id, name, supertype, subtypes, hp, types, evolves_from, rarity, artist, set_id, set_name, set_series, number, regulation_mark, image_small, image_large, raw_data, prices FROM tcg_cards WHERE NOT is_custom",
                os.path.join(OUTPUT_DIR, "cards.parquet"), "cards.parquet")

    safe_export(conn, "sets", "SELECT * FROM sets",
                os.path.join(OUTPUT_DIR, "sets.parquet"), "sets.parquet")

    safe_export(conn, "pokemon_metadata",
                "SELECT pokedex_number, name, region, generation, color, shape, genus, encounter_location, evolution_chain FROM pokemon_metadata",
                os.path.join(OUTPUT_DIR, "pokemon_metadata.parquet"), "pokemon_metadata.parquet")

    safe_export(conn, "pocket_sets", "SELECT * FROM pocket_sets",
                os.path.join(OUTPUT_DIR, "pocket_sets.parquet"), "pocket_sets.parquet")

    safe_export(conn, "pocket_cards",
                "SELECT id, name, set_id, number, rarity, card_type, element, hp, stage, retreat_cost, weakness, evolves_from, packs, image_url, image_filename, illustrator, raw_data FROM pocket_cards WHERE NOT is_custom",
                os.path.join(OUTPUT_DIR, "pocket_cards.parquet"), "pocket_cards.parquet")

    conn.close()
    print("Done!")


if __name__ == "__main__":
    export()
