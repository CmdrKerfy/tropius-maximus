"""
Export DuckDB tables to Parquet files for the static site.

Reads scripts/pokemon.duckdb and writes:
  - public/data/cards.parquet  (all card columns, ZSTD compressed)
  - public/data/sets.parquet   (all set columns, ZSTD compressed)

Usage:
    python export_parquet.py
"""

import os
import duckdb

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(SCRIPT_DIR, "..", "public", "data", "pokemon.duckdb")
OUTPUT_DIR = os.path.join(SCRIPT_DIR, "..", "public", "data")


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
    conn = duckdb.connect(DB_PATH, read_only=True)

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
