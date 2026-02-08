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
DB_PATH = os.path.join(SCRIPT_DIR, "pokemon.duckdb")
OUTPUT_DIR = os.path.join(SCRIPT_DIR, "..", "public", "data")


def export():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    conn = duckdb.connect(DB_PATH, read_only=True)

    cards_path = os.path.join(OUTPUT_DIR, "cards.parquet")
    conn.execute(f"""
        COPY (SELECT * FROM cards)
        TO '{cards_path}'
        (FORMAT PARQUET, COMPRESSION ZSTD)
    """)
    cards_size = os.path.getsize(cards_path)
    print(f"  cards.parquet: {cards_size / 1024 / 1024:.1f} MB")

    sets_path = os.path.join(OUTPUT_DIR, "sets.parquet")
    conn.execute(f"""
        COPY (SELECT * FROM sets)
        TO '{sets_path}'
        (FORMAT PARQUET, COMPRESSION ZSTD)
    """)
    sets_size = os.path.getsize(sets_path)
    print(f"  sets.parquet: {sets_size / 1024:.0f} KB")

    # Export pokemon_metadata if it exists
    try:
        pokemon_path = os.path.join(OUTPUT_DIR, "pokemon_metadata.parquet")
        conn.execute(f"""
            COPY (SELECT pokedex_number, name, region, generation, color, shape, genus, encounter_location, evolution_chain FROM pokemon_metadata)
            TO '{pokemon_path}'
            (FORMAT PARQUET, COMPRESSION ZSTD)
        """)
        pokemon_size = os.path.getsize(pokemon_path)
        print(f"  pokemon_metadata.parquet: {pokemon_size / 1024:.0f} KB")
    except Exception as e:
        print(f"  pokemon_metadata.parquet: skipped (table not found)")

    conn.close()
    print("Done!")


if __name__ == "__main__":
    export()
