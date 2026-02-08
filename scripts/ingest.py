"""
Data ingestion script — fetches all Pokemon cards and sets from the
pokemontcg.io API and stores them in DuckDB.

Uses the official Pokemon TCG API which includes TCGPlayer and Cardmarket
pricing data. The GitHub repo (PokemonTCG/pokemon-tcg-data) is still used
for the set list, but card data comes from the API for pricing.

Also fetches Pokemon metadata (region, generation, color, evolution chain)
from PokeAPI for auto-populating card metadata based on Pokedex numbers.

This is a standalone version for the static site pipeline.
It creates a local DuckDB file at scripts/pokemon.duckdb.

Usage:
    python ingest.py              # Fetch ALL cards (~15k) + Pokemon metadata
    python ingest.py --set sv1    # Fetch only set "sv1" (good for testing)
    python ingest.py --skip-pokemon  # Skip PokeAPI fetch (use existing data)
    python ingest.py --force      # Re-download all sets even if already present

Features:
    - Resume: Automatically skips sets that are already fully ingested
    - Retry: Retries failed API requests up to 3 times with backoff

Environment:
    POKEMON_TCG_API_KEY    Optional API key for higher rate limits (free to register)
"""

import argparse
import json
import os
import time
from typing import Optional

import httpx
import duckdb

# ── Configuration ────────────────────────────────────────────────────────

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(SCRIPT_DIR, "pokemon.duckdb")

# Base URL for raw JSON files on GitHub (used for sets).
GITHUB_RAW = "https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master"

# GitHub API to list available card files.
GITHUB_API = "https://api.github.com/repos/PokemonTCG/pokemon-tcg-data/contents/cards/en"

# Pokemon TCG API (includes pricing data).
POKEMON_TCG_API = "https://api.pokemontcg.io/v2"

# PokeAPI for Pokemon metadata (species, color, evolution chains).
POKEAPI_BASE = "https://pokeapi.co/api/v2"

REQUEST_TIMEOUT = 120  # Increased for large sets
MAX_RETRIES = 3
RETRY_DELAY = 5  # seconds

# Region/generation mapping by Pokedex number ranges.
REGION_GEN_RANGES = [
    (151, 1, "Kanto"),
    (251, 2, "Johto"),
    (386, 3, "Hoenn"),
    (493, 4, "Sinnoh"),
    (649, 5, "Unova"),
    (721, 6, "Kalos"),
    (809, 7, "Alola"),
    (905, 8, "Galar"),
    (1025, 9, "Paldea"),
]


def get_region_generation(pokedex_num: int) -> tuple:
    """Derive region and generation from Pokedex number."""
    for max_num, gen, region in REGION_GEN_RANGES:
        if pokedex_num <= max_num:
            return gen, region
    return None, None


def get_connection() -> duckdb.DuckDBPyConnection:
    """Open (or create) the DuckDB database file and return a connection."""
    return duckdb.connect(DB_PATH)


def initialize_database() -> None:
    """Create all tables if they don't already exist."""
    conn = get_connection()

    conn.execute("""
        CREATE TABLE IF NOT EXISTS cards (
            id            VARCHAR PRIMARY KEY,
            name          VARCHAR,
            supertype     VARCHAR,
            subtypes      VARCHAR,
            hp            VARCHAR,
            types         VARCHAR,
            evolves_from  VARCHAR,
            rarity        VARCHAR,
            artist        VARCHAR,
            set_id        VARCHAR,
            set_name      VARCHAR,
            set_series    VARCHAR,
            number        VARCHAR,
            regulation_mark VARCHAR,
            image_small   VARCHAR,
            image_large   VARCHAR,
            raw_data      JSON,
            prices        JSON
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS sets (
            id            VARCHAR PRIMARY KEY,
            name          VARCHAR,
            series        VARCHAR,
            printed_total INTEGER,
            total         INTEGER,
            release_date  VARCHAR,
            symbol_url    VARCHAR,
            logo_url      VARCHAR
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS pokemon_metadata (
            pokedex_number INTEGER PRIMARY KEY,
            name           VARCHAR,
            region         VARCHAR,
            generation     INTEGER,
            color          VARCHAR,
            shape          VARCHAR,
            genus          VARCHAR,
            encounter_location VARCHAR,
            evolution_chain VARCHAR
        )
    """)

    conn.close()


# ── Set ingestion ────────────────────────────────────────────────────────

def ingest_sets() -> dict:
    """Fetch all sets from the GitHub repo and upsert into the sets table."""
    print("Fetching sets...")
    resp = httpx.get(f"{GITHUB_RAW}/sets/en.json", timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    data = resp.json()
    print(f"  Got {len(data)} sets")

    conn = get_connection()
    for s in data:
        conn.execute("""
            INSERT OR REPLACE INTO sets
                (id, name, series, printed_total, total, release_date, symbol_url, logo_url)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, [
            s["id"],
            s["name"],
            s.get("series", ""),
            s.get("printedTotal", 0),
            s.get("total", 0),
            s.get("releaseDate", ""),
            s.get("images", {}).get("symbol", ""),
            s.get("images", {}).get("logo", ""),
        ])
    conn.close()
    print("  Sets saved.")

    return {s["id"]: s for s in data}


# ── Card ingestion ───────────────────────────────────────────────────────

def get_set_file_list() -> list:
    """Get the list of available card JSON files from GitHub."""
    resp = httpx.get(GITHUB_API, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    files = resp.json()
    return [f["name"].replace(".json", "") for f in files if f["name"].endswith(".json")]


def fetch_cards_from_api(set_id: str) -> list:
    """Fetch all cards for a set from the pokemontcg.io API (with pagination and retry)."""
    api_key = os.environ.get("POKEMON_TCG_API_KEY", "")
    headers = {"X-Api-Key": api_key} if api_key else {}

    all_cards = []
    page = 1
    page_size = 250

    while True:
        # Retry logic for each page
        last_error = None
        for attempt in range(MAX_RETRIES):
            try:
                resp = httpx.get(
                    f"{POKEMON_TCG_API}/cards",
                    params={"q": f"set.id:{set_id}", "page": page, "pageSize": page_size},
                    headers=headers,
                    timeout=REQUEST_TIMEOUT,
                )
                resp.raise_for_status()
                data = resp.json()
                break  # Success, exit retry loop
            except (httpx.HTTPError, httpx.TimeoutException) as e:
                last_error = e
                if attempt < MAX_RETRIES - 1:
                    wait_time = RETRY_DELAY * (attempt + 1)  # Exponential-ish backoff
                    time.sleep(wait_time)
                    continue
                raise last_error  # All retries exhausted

        cards = data.get("data", [])
        all_cards.extend(cards)

        # Check if there are more pages
        total_count = data.get("totalCount", 0)
        if len(all_cards) >= total_count or len(cards) < page_size:
            break

        page += 1

    return all_cards


def get_existing_card_count(conn, set_id: str) -> int:
    """Check how many cards already exist for a set in the database."""
    result = conn.execute(
        "SELECT COUNT(*) FROM cards WHERE set_id = ?", [set_id]
    ).fetchone()
    return result[0] if result else 0


def ingest_cards(set_lookup: dict, set_id: Optional[str] = None, force: bool = False) -> int:
    """Download cards from the pokemontcg.io API and upsert into the cards table.

    If force=False (default), skips sets that already have cards in the database.
    """
    if set_id:
        set_ids = [set_id]
        print(f"Fetching cards for set '{set_id}'...")
    else:
        print("Finding available sets...")
        set_ids = get_set_file_list()
        print(f"  Found {len(set_ids)} sets to download")

    conn = get_connection()
    total_ingested = 0
    skipped_count = 0

    for i, sid in enumerate(set_ids, 1):
        # Check if set already has cards (resume logic)
        if not force:
            existing = get_existing_card_count(conn, sid)
            expected = set_lookup.get(sid, {}).get("total", 0)
            if existing > 0 and (expected == 0 or existing >= expected):
                print(f"  [{i}/{len(set_ids)}] {sid}... skipped (already have {existing} cards)")
                skipped_count += 1
                continue

        print(f"  [{i}/{len(set_ids)}] {sid}...", end=" ", flush=True)

        try:
            cards = fetch_cards_from_api(sid)
        except (httpx.HTTPError, httpx.TimeoutException) as e:
            print(f"failed after {MAX_RETRIES} retries ({e})")
            continue

        set_info = set_lookup.get(sid, {})
        set_name = set_info.get("name", sid)
        set_series = set_info.get("series", "")

        for card in cards:
            images = card.get("images", {})

            # Extract pricing data
            prices = {
                "tcgplayer": card.get("tcgplayer"),
                "cardmarket": card.get("cardmarket"),
            }

            conn.execute("""
                INSERT OR REPLACE INTO cards
                    (id, name, supertype, subtypes, hp, types, evolves_from,
                     rarity, artist, set_id, set_name, set_series, number,
                     regulation_mark, image_small, image_large, raw_data, prices)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, [
                card["id"],
                card.get("name", ""),
                card.get("supertype", ""),
                json.dumps(card.get("subtypes", [])),
                card.get("hp", ""),
                json.dumps(card.get("types", [])),
                card.get("evolvesFrom", ""),
                card.get("rarity", ""),
                card.get("artist", ""),
                sid,
                set_name,
                set_series,
                card.get("number", ""),
                card.get("regulationMark", ""),
                images.get("small", ""),
                images.get("large", ""),
                json.dumps(card),
                json.dumps(prices) if prices["tcgplayer"] or prices["cardmarket"] else None,
            ])

        total_ingested += len(cards)
        print(f"{len(cards)} cards")

        # Rate limit: be gentle with the API
        if i < len(set_ids):
            time.sleep(0.5)

    conn.close()
    if skipped_count > 0:
        print(f"Done! Ingested {total_ingested} cards total ({skipped_count} sets skipped - already complete).")
    else:
        print(f"Done! Ingested {total_ingested} cards total.")
    return total_ingested


# ── Pokemon metadata ingestion ──────────────────────────────────────────


def fetch_first_encounter_location(pokedex_num: int) -> str:
    """Fetch first encounter location from PokeAPI."""
    try:
        resp = httpx.get(
            f"{POKEAPI_BASE}/pokemon/{pokedex_num}/encounters",
            timeout=REQUEST_TIMEOUT
        )
        resp.raise_for_status()
        encounters = resp.json()
        if encounters:
            return encounters[0]["location_area"]["name"].replace("-", " ").title()
        return ""
    except Exception:
        return ""


def fetch_evolution_chain(chain_url: str) -> list:
    """Fetch and flatten an evolution chain from PokeAPI."""
    try:
        resp = httpx.get(chain_url, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()

        # Flatten the chain
        names = []

        def walk_chain(node):
            species_name = node["species"]["name"]
            names.append(species_name)
            for evo in node.get("evolves_to", []):
                walk_chain(evo)

        walk_chain(data["chain"])
        return names
    except Exception:
        return []


def get_existing_pokemon_count(conn) -> int:
    """Check how many Pokemon are already in the metadata table."""
    result = conn.execute("SELECT COUNT(*) FROM pokemon_metadata").fetchone()
    return result[0] if result else 0


def ingest_pokemon_metadata(force: bool = False) -> int:
    """Fetch all Pokemon species from PokeAPI and store metadata."""
    print("Fetching Pokemon metadata from PokeAPI...")

    conn = get_connection()

    # First, get the total count of species
    resp = httpx.get(
        f"{POKEAPI_BASE}/pokemon-species",
        params={"limit": 1},
        timeout=REQUEST_TIMEOUT,
    )
    resp.raise_for_status()
    total_count = resp.json()["count"]
    print(f"  Found {total_count} Pokemon species")

    # Check if we already have all species (resume logic)
    if not force:
        existing = get_existing_pokemon_count(conn)
        if existing >= total_count:
            print(f"  Skipped (already have {existing} species)")
            conn.close()
            return existing

    # Fetch all species in batches
    all_species = []
    offset = 0
    batch_size = 100

    while offset < total_count:
        resp = httpx.get(
            f"{POKEAPI_BASE}/pokemon-species",
            params={"limit": batch_size, "offset": offset},
            timeout=REQUEST_TIMEOUT,
        )
        resp.raise_for_status()
        results = resp.json()["results"]
        all_species.extend(results)
        offset += batch_size
        print(f"  Fetched species list: {len(all_species)}/{total_count}", end="\r")

    print()

    # Cache for evolution chains to avoid re-fetching
    chain_cache = {}
    ingested = 0

    for i, species_info in enumerate(all_species, 1):
        print(f"  [{i}/{len(all_species)}] {species_info['name']}...", end="\r")

        try:
            # Fetch individual species details
            resp = httpx.get(species_info["url"], timeout=REQUEST_TIMEOUT)
            resp.raise_for_status()
            species = resp.json()

            pokedex_num = species["id"]
            name = species["name"]
            color = species.get("color", {}).get("name", "")
            shape = species.get("shape", {}).get("name", "") if species.get("shape") else ""

            # Get genus (English entry)
            genus = ""
            for g in species.get("genera", []):
                if g.get("language", {}).get("name") == "en":
                    genus = g.get("genus", "")
                    break

            # Get region and generation from Pokedex number
            generation, region = get_region_generation(pokedex_num)

            # Fetch first encounter location
            encounter_location = fetch_first_encounter_location(pokedex_num)

            # Fetch evolution chain (with caching)
            evo_chain_url = species.get("evolution_chain", {}).get("url", "")
            if evo_chain_url:
                if evo_chain_url not in chain_cache:
                    chain_cache[evo_chain_url] = fetch_evolution_chain(evo_chain_url)
                evo_chain = chain_cache[evo_chain_url]
            else:
                evo_chain = [name]

            # Store in database
            conn.execute("""
                INSERT OR REPLACE INTO pokemon_metadata
                    (pokedex_number, name, region, generation, color, shape, genus, encounter_location, evolution_chain)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, [
                pokedex_num,
                name,
                region,
                generation,
                color,
                shape,
                genus,
                encounter_location,
                json.dumps(evo_chain),
            ])

            ingested += 1

            # Rate limit: PokeAPI is generous but let's be polite
            if i % 20 == 0:
                time.sleep(0.1)

        except Exception as e:
            print(f"\n  Warning: Failed to fetch {species_info['name']}: {e}")
            continue

    conn.close()
    print(f"\nDone! Ingested {ingested} Pokemon species.")
    return ingested


def run_ingestion(set_id: Optional[str] = None, skip_pokemon: bool = False, force: bool = False) -> int:
    """Run the full ingestion pipeline."""
    initialize_database()

    # Ingest Pokemon metadata first (unless skipped)
    if not skip_pokemon:
        ingest_pokemon_metadata(force=force)

    set_lookup = ingest_sets()
    total = ingest_cards(set_lookup, set_id=set_id, force=force)
    return total


def main():
    parser = argparse.ArgumentParser(description="Ingest Pokemon TCG data into DuckDB")
    parser.add_argument(
        "--set",
        dest="set_id",
        default=None,
        help="Only fetch cards from this set ID (e.g. 'sv1'). Omit to fetch all.",
    )
    parser.add_argument(
        "--skip-pokemon",
        dest="skip_pokemon",
        action="store_true",
        help="Skip fetching Pokemon metadata from PokeAPI (use existing data).",
    )
    parser.add_argument(
        "--force",
        dest="force",
        action="store_true",
        help="Force re-download of all sets, even if already in database.",
    )
    args = parser.parse_args()
    run_ingestion(set_id=args.set_id, skip_pokemon=args.skip_pokemon, force=args.force)


if __name__ == "__main__":
    main()
