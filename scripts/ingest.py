"""
Data ingestion script — fetches all Pokemon cards and sets from the
pokemontcg.io API and stores them in DuckDB.

Uses the official Pokemon TCG API which includes TCGPlayer and Cardmarket
pricing data. The GitHub repo (PokemonTCG/pokemon-tcg-data) is still used
for the set list, but card data comes from the API for pricing.

Also fetches Pokemon metadata (region, generation, color, evolution chain)
from PokeAPI for auto-populating card metadata based on Pokedex numbers.

Additionally fetches Pokemon TCG Pocket cards from the TCGdex API
into separate tables.

This is a standalone version for the static site pipeline.
It creates a local DuckDB file at scripts/pokemon.duckdb.

Usage:
    python ingest.py              # Fetch ALL cards (~15k) + Pokemon metadata + Pocket
    python ingest.py --set sv1    # Fetch only set "sv1" (good for testing)
    python ingest.py --skip-pokemon    # Skip PokeAPI fetch (use existing data)
    python ingest.py --skip-pocket     # Skip Pokemon TCG Pocket data
    python ingest.py --pocket          # Only fetch Pocket data (skip TCG + Pokemon)
    python ingest.py --force           # Re-download all sets even if already present
    python ingest.py --push-supabase   # After ingest, run push_duckdb_to_supabase.py (needs SUPABASE_* env)
    python ingest.py --fail-on-partial # Exit 1 if any fetch step skipped data (for CI alerting)

Features:
    - Resume: Automatically skips sets that are already fully ingested
    - Retry: Retries failed API requests up to 3 times with backoff

Environment:
    POKEMON_TCG_API_KEY    Optional API key for higher rate limits (free to register)
"""

import argparse
import functools
import json
import os
from urllib.parse import quote
import re
import subprocess
import sys
import time
import unicodedata
from dataclasses import dataclass
from typing import Optional

from jpn_card_key_utils import _normalize_jpn_number, _build_jpn_card_key
import httpx
import duckdb


@dataclass
class IngestFailureSummary:
    """Counts of API/data steps that logged a warning and continued (CI can fail on these)."""

    tcg_set_fetch_failures: int = 0
    pokemon_species_fetch_failures: int = 0
    pocket_set_fetch_failures: int = 0
    pocket_card_fetch_failures: int = 0
    japanese_set_fetch_failures: int = 0
    japanese_card_fetch_failures: int = 0
    japanese_ptcgdb_failures: int = 0

    def has_partial_failures(self) -> bool:
        return (
            self.tcg_set_fetch_failures
            + self.pokemon_species_fetch_failures
            + self.pocket_set_fetch_failures
            + self.pocket_card_fetch_failures
            + self.japanese_set_fetch_failures
            + self.japanese_card_fetch_failures
            + self.japanese_ptcgdb_failures
        ) > 0


# ── Configuration ────────────────────────────────────────────────────────

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(SCRIPT_DIR, "..", "public", "data", "pokemon.duckdb")

# Base URL for raw JSON files on GitHub (used for sets).
GITHUB_RAW = "https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master"

# GitHub API to list available card files.
GITHUB_API = "https://api.github.com/repos/PokemonTCG/pokemon-tcg-data/contents/cards/en"

# Pokemon TCG API (includes pricing data).
POKEMON_TCG_API = "https://api.pokemontcg.io/v2"

# PokeAPI for Pokemon metadata (species, color, evolution chains).
POKEAPI_BASE = "https://pokeapi.co/api/v2"

# TCGdex API (used for Pocket card data and images).
TCGDEX_API_BASE = "https://api.tcgdex.net/v2/en"
TCGDEX_JA_BASE = "https://api.tcgdex.net/v2/ja"
POCKET_IMAGE_BASE = "https://assets.tcgdex.net/en/tcgp"

REQUEST_TIMEOUT = 120  # Increased for large sets


def _tcgdx_webp_from_image_field(image: object) -> str:
    """Turn TCGdex `image` (string base URL or small dict) into a full *.webp URL, or ''."""
    if isinstance(image, str) and image.strip():
        b = image.strip().rstrip("/")
        if b.endswith(".webp"):
            return b
        return f"{b}/high.webp"
    if isinstance(image, dict):
        for key in ("high", "large", "small", "default"):
            v = image.get(key)
            if isinstance(v, str) and v.startswith("http"):
                b = v.strip().rstrip("/")
                if b.endswith(".webp"):
                    return b
                return f"{b}/high.webp"
        b = image.get("url") or image.get("base")
        if isinstance(b, str) and b.strip():
            b = b.strip().rstrip("/")
            return f"{b}/high.webp" if not b.endswith(".webp") else b
    return ""


def _tcgdx_en_asset_high_webp(serie_id: str, set_id: str, local_id: str) -> str:
    """EN assets path: /en/{serie.lower}/{set.lower}/{n}/high.webp (n = int localId when numeric)."""
    ser = (serie_id or "").strip()
    sid = (set_id or "").strip()
    loc = str(local_id or "").strip()
    if not (ser and sid and loc):
        return ""
    try:
        nseg = str(int(loc, 10))
    except ValueError:
        nseg = loc.lower()
    return f"https://assets.tcgdex.net/en/{ser.lower()}/{sid.lower()}/{nseg}/high.webp"


def _tcgdx_ja_asset_high_webp(serie_id: str, set_id: str, local_id: str) -> str:
    """JA assets path uses API casing: /ja/{SV}/{SV1S}/001/high.webp."""
    ser = (serie_id or "").strip()
    sid = (set_id or "").strip()
    loc = str(local_id or "").strip()
    if not (ser and sid and loc):
        return ""
    return f"https://assets.tcgdex.net/ja/{ser}/{sid}/{loc}/high.webp"


@functools.lru_cache(maxsize=32768)
def _tcgdx_asset_head_ok(url: str) -> bool:
    """True if the CDN returns 200 for this asset (HEAD). Cached across cards in one ingest run."""
    if not url:
        return False
    try:
        r = httpx.head(url, timeout=15, follow_redirects=True)
        return r.status_code == 200
    except Exception:
        return False


def tcgdx_card_high_webp_url(card: dict, *, serie_id: str, set_id: str, japanese_locale: bool) -> str:
    """
    Full card image URL for DuckDB image_url → Supabase image_small / image_large.

    For **Japanese** (`japanese_locale=True`): prefer `ja/...` when it exists on the CDN; many
    Sun & Moon JP rows 404 on `ja/...` while `en/.../high.webp` still serves the same scan.

    For **Pocket** (`japanese_locale=False`): prefer EN assets; JA path is only a last resort.
    """
    u = _tcgdx_webp_from_image_field(card.get("image"))
    if u:
        return u
    loc = str(card.get("localId", "") or "").strip()
    ser = (serie_id or "").strip()
    sid = (set_id or "").strip()
    if not (ser and sid and loc):
        return ""
    ja_u = _tcgdx_ja_asset_high_webp(ser, sid, loc)
    en_u = _tcgdx_en_asset_high_webp(ser, sid, loc)
    if japanese_locale:
        if ja_u and _tcgdx_asset_head_ok(ja_u):
            return ja_u
        if en_u and _tcgdx_asset_head_ok(en_u):
            return en_u
        return ""  # neither CDN path has this scan — app will show fallback
    if en_u and _tcgdx_asset_head_ok(en_u):
        return en_u
    if ja_u and _tcgdx_asset_head_ok(ja_u):
        return ja_u
    return ""  # neither CDN path available


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


def normalize_supertype(s: str) -> str:
    """Return canonical supertype: 'Pokémon' for any Pokémon variant (including mojibake), else unchanged."""
    if not s or not isinstance(s, str):
        return s or ""
    # NFD + strip combining characters, then lowercase
    norm = unicodedata.normalize("NFD", s)
    norm = re.sub(r"[\u0300-\u036f]", "", norm).lower()
    if norm == "pokemon":
        return "Pokémon"
    # Mojibake/corrupted "Pokémon": letters-only "pokmon" or "pokemon"
    alpha_only = re.sub(r"[^a-zA-Z]", "", s).lower()
    if alpha_only in ("pokemon", "pokmon"):
        return "Pokémon"
    return s


def normalize_supertypes_in_db(conn: duckdb.DuckDBPyConnection) -> int:
    """Update tcg_cards: set supertype = 'Pokémon' for every row whose supertype is a variant. Returns number of distinct variants fixed."""
    rows = conn.execute(
        "SELECT DISTINCT supertype FROM tcg_cards WHERE supertype IS NOT NULL AND supertype != ''"
    ).fetchall()
    variants_fixed = 0
    for (val,) in rows:
        if val == "Pokémon":
            continue
        if normalize_supertype(val) == "Pokémon":
            conn.execute(
                "UPDATE tcg_cards SET supertype = 'Pokémon' WHERE supertype = ?", [val]
            )
            variants_fixed += 1
    return variants_fixed


def initialize_database() -> None:
    """Create all tables if they don't already exist."""
    conn = get_connection()

    conn.execute("""
        CREATE TABLE IF NOT EXISTS tcg_cards (
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
            prices        JSON,
            source        VARCHAR DEFAULT 'TCG',
            is_custom     BOOLEAN DEFAULT FALSE
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
        CREATE TABLE IF NOT EXISTS failed_sets (
            set_id    VARCHAR PRIMARY KEY,
            reason    VARCHAR,
            failed_at TIMESTAMP DEFAULT current_timestamp
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

    conn.execute("""
        CREATE TABLE IF NOT EXISTS pocket_sets (
            id            VARCHAR PRIMARY KEY,
            name          VARCHAR,
            series        VARCHAR,
            release_date  VARCHAR,
            card_count    INTEGER,
            packs         JSON,
            logo_url      VARCHAR
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS pocket_cards (
            id              VARCHAR PRIMARY KEY,
            name            VARCHAR,
            set_id          VARCHAR,
            number          INTEGER,
            rarity          VARCHAR,
            card_type       VARCHAR,
            element         VARCHAR,
            hp              INTEGER,
            stage           VARCHAR,
            retreat_cost    INTEGER,
            weakness        VARCHAR,
            evolves_from    VARCHAR,
            packs           JSON,
            image_url       VARCHAR,
            image_filename  VARCHAR,
            illustrator     VARCHAR,
            raw_data        JSON,
            is_custom       BOOLEAN DEFAULT FALSE
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS japanese_sets (
            id            VARCHAR PRIMARY KEY,
            name          VARCHAR,
            series        VARCHAR,
            release_date  VARCHAR,
            card_count    INTEGER,
            logo_url      VARCHAR
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS japanese_cards (
            id              VARCHAR PRIMARY KEY,
            name            VARCHAR,
            set_id          VARCHAR,
            number          INTEGER,
            rarity          VARCHAR,
            card_type       VARCHAR,
            element         VARCHAR,
            hp              INTEGER,
            stage           VARCHAR,
            retreat_cost    INTEGER,
            weakness        VARCHAR,
            evolves_from    VARCHAR,
            illustrator     VARCHAR,
            image_url       VARCHAR,
            raw_data        JSON,
            is_custom       BOOLEAN DEFAULT FALSE
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS japanese_cards_ptcgdb (
            id              VARCHAR PRIMARY KEY,
            name            VARCHAR,
            set_id          VARCHAR,
            number          VARCHAR,
            rarity          VARCHAR,
            card_type       VARCHAR,
            element         VARCHAR,
            types           JSON,
            subtypes        JSON,
            hp              VARCHAR,
            stage           VARCHAR,
            retreat_cost    INTEGER,
            weakness        VARCHAR,
            evolves_from    VARCHAR,
            illustrator     VARCHAR,
            image_small     VARCHAR,
            image_large     VARCHAR,
            raw_data        JSON,
            is_custom       BOOLEAN DEFAULT FALSE
        )
    """)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS failed_sets_ptcgdb (
            set_id   VARCHAR PRIMARY KEY,
            reason   VARCHAR,
            failed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Migrate: add columns if they don't exist (schema upgrades)
    existing_cols = {row[0] for row in conn.execute("DESCRIBE pocket_cards").fetchall()}
    if "illustrator" not in existing_cols:
        conn.execute("ALTER TABLE pocket_cards ADD COLUMN illustrator VARCHAR")
    if "is_custom" not in existing_cols:
        conn.execute("ALTER TABLE pocket_cards ADD COLUMN is_custom BOOLEAN DEFAULT FALSE")

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
            except httpx.HTTPStatusError as e:
                if e.response.status_code < 500:
                    raise  # 4xx = permanent failure, don't retry
                last_error = e
                if attempt < MAX_RETRIES - 1:
                    time.sleep(RETRY_DELAY * (attempt + 1))
            except (httpx.HTTPError, httpx.TimeoutException) as e:
                last_error = e
                if attempt < MAX_RETRIES - 1:
                    time.sleep(RETRY_DELAY * (attempt + 1))
        else:
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
        "SELECT COUNT(*) FROM tcg_cards WHERE set_id = ?", [set_id]
    ).fetchone()
    return result[0] if result else 0


def ingest_cards(set_lookup: dict, set_id: Optional[str] = None, force: bool = False) -> tuple[int, int]:
    """Download cards from the pokemontcg.io API and upsert into the cards table.

    If force=False (default), skips sets that already have cards in the database.

    Returns (total_ingested_cards, set_fetch_failures) where set_fetch_failures counts
    sets that hit an API error and were skipped (including rows written to failed_sets).
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
    set_fetch_failures = 0

    # Load permanently-failed sets so we don't retry them
    failed_sets = {row[0] for row in conn.execute("SELECT set_id FROM failed_sets").fetchall()}
    perm_skipped = 0

    for i, sid in enumerate(set_ids, 1):
        # Skip sets that have permanently failed (4xx) in a previous run
        if not force and sid in failed_sets:
            perm_skipped += 1
            continue

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
        except httpx.HTTPStatusError as e:
            set_fetch_failures += 1
            if e.response.status_code < 500:
                conn.execute(
                    "INSERT OR REPLACE INTO failed_sets (set_id, reason) VALUES (?, ?)",
                    [sid, str(e.response.status_code)],
                )
                print(f"permanently unavailable ({e.response.status_code}) — will skip in future runs")
            else:
                print(f"failed after {MAX_RETRIES} retries (HTTP {e.response.status_code})")
            continue
        except (httpx.HTTPError, httpx.TimeoutException) as e:
            set_fetch_failures += 1
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
                INSERT OR REPLACE INTO tcg_cards
                    (id, name, supertype, subtypes, hp, types, evolves_from,
                     rarity, artist, set_id, set_name, set_series, number,
                     regulation_mark, image_small, image_large, raw_data, prices,
                     source, is_custom)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'TCG', FALSE)
            """, [
                card["id"],
                card.get("name", ""),
                normalize_supertype(card.get("supertype", "") or ""),
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

    # Standardize any remaining Pokémon supertype variants (e.g. mojibake) to 'Pokémon'
    fixed = normalize_supertypes_in_db(conn)
    if fixed:
        print(f"Normalized {fixed} supertype value(s) to 'Pokémon'.")

    conn.close()
    parts = [f"Ingested {total_ingested} cards total."]
    if skipped_count:
        parts.append(f"{skipped_count} sets already complete.")
    if perm_skipped:
        parts.append(f"{perm_skipped} sets permanently unavailable (skipped).")
    if set_fetch_failures:
        parts.append(f"{set_fetch_failures} set(s) had fetch errors this run.")
    print("Done! " + " ".join(parts))
    return total_ingested, set_fetch_failures


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


def ingest_pokemon_metadata(force: bool = False) -> tuple[int, int]:
    """Fetch all Pokemon species from PokeAPI and store metadata.

    Returns (species_rows_ingested_this_run, species_fetch_failures).
    """
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
            return existing, 0

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
    species_fetch_failures = 0

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
            species_fetch_failures += 1
            print(f"\n  Warning: Failed to fetch {species_info['name']}: {e}")
            continue

    conn.close()
    print(f"\nDone! Ingested {ingested} Pokemon species.")
    if species_fetch_failures:
        print(f"  ({species_fetch_failures} species fetch error(s) this run.)")
    return ingested, species_fetch_failures


# ── Pocket ingestion ────────────────────────────────────────────────────


def ingest_pocket_sets() -> None:
    """Fetch Pocket sets from the TCGdex API and upsert into pocket_sets."""
    print("Fetching Pocket sets...")
    resp = httpx.get(f"{TCGDEX_API_BASE}/series/tcgp", timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    data = resp.json()

    sets_list = data.get("sets", [])
    conn = get_connection()
    conn.execute("DELETE FROM pocket_sets")
    count = 0
    for s in sets_list:
        card_count_raw = s.get("cardCount", {})
        if isinstance(card_count_raw, dict):
            card_count = card_count_raw.get("official", card_count_raw.get("total", 0))
        else:
            card_count = int(card_count_raw) if card_count_raw else 0

        conn.execute("""
            INSERT INTO pocket_sets
                (id, name, series, release_date, card_count, packs, logo_url)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, [
            s["id"],
            s.get("name", s["id"]),
            "tcgp",
            s.get("releaseDate", ""),
            card_count,
            json.dumps([]),
            "",
        ])
        count += 1

    conn.close()
    print(f"  Saved {count} Pocket sets.")


def ingest_pocket_cards(force: bool = False) -> tuple[int, int, int]:
    """Fetch Pocket cards from the TCGdex API and upsert into pocket_cards.

    Returns (cards_ingested, pocket_set_fetch_failures, pocket_card_fetch_failures).
    """
    conn = get_connection()

    # Resume check
    if not force:
        result = conn.execute("SELECT COUNT(*) FROM pocket_cards").fetchone()
        existing = result[0] if result else 0
        if existing > 0:
            print(f"Pocket cards: skipped (already have {existing} cards). Use --force to re-download.")
            conn.close()
            return existing, 0, 0

    print("Fetching Pocket cards from TCGdex...")

    # Get all sets in the tcgp series
    resp = httpx.get(f"{TCGDEX_API_BASE}/series/tcgp", timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    series_data = resp.json()
    sets_list = series_data.get("sets", [])
    print(f"  Found {len(sets_list)} Pocket sets")

    conn.execute("DELETE FROM pocket_cards")
    ingested = 0
    pocket_set_fetch_failures = 0
    pocket_card_fetch_failures = 0
    for set_idx, set_info in enumerate(sets_list, 1):
        set_id = set_info["id"]
        print(f"  [{set_idx}/{len(sets_list)}] {set_id}...", end=" ", flush=True)

        # Fetch abbreviated card list for this set
        try:
            set_resp = httpx.get(f"{TCGDEX_API_BASE}/sets/{set_id}", timeout=REQUEST_TIMEOUT)
            set_resp.raise_for_status()
            set_data = set_resp.json()
        except Exception as e:
            pocket_set_fetch_failures += 1
            print(f"failed ({e})")
            continue

        serie_id = (set_data.get("serie") or {}).get("id") or ""
        cards_brief = set_data.get("cards", [])
        set_ingested = 0

        for card_brief in cards_brief:
            card_id = card_brief["id"]

            # Fetch full card data
            try:
                card_resp = httpx.get(f"{TCGDEX_API_BASE}/cards/{card_id}", timeout=REQUEST_TIMEOUT)
                card_resp.raise_for_status()
                card = card_resp.json()
            except Exception as e:
                pocket_card_fetch_failures += 1
                print(f"\n    Warning: Failed to fetch {card_id}: {e}")
                time.sleep(0.05)
                continue

            # Parse number from localId (e.g., "001" -> 1)
            local_id = card.get("localId", "")
            try:
                number = int(local_id)
            except (ValueError, TypeError):
                number = 0

            # Map card type (category), lowercase
            category = card.get("category", "")
            card_type = category.lower() if category else ""

            # Map element (first type)
            types = card.get("types") or []
            element = types[0] if types else ""

            # Map stage (lowercase)
            stage_raw = card.get("stage", "")
            stage = stage_raw.lower() if stage_raw else ""

            # Map weakness (first entry's type)
            weaknesses = card.get("weaknesses") or []
            weakness = weaknesses[0].get("type", "") if weaknesses else ""

            # Map boosters to packs
            boosters = card.get("boosters") or []
            packs = [{"id": b.get("id", ""), "name": b.get("name", "")} for b in boosters]

            image_url = tcgdx_card_high_webp_url(
                card, serie_id=serie_id, set_id=set_id, japanese_locale=False
            )

            conn.execute("""
                INSERT INTO pocket_cards
                    (id, name, set_id, number, rarity, card_type, element, hp,
                     stage, retreat_cost, weakness, evolves_from, packs,
                     image_url, image_filename, illustrator, raw_data)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, [
                card_id,
                card.get("name", ""),
                set_id,
                number,
                card.get("rarity", ""),
                card_type,
                element,
                card.get("hp"),
                stage,
                card.get("retreat"),
                weakness,
                card.get("evolveFrom", ""),
                json.dumps(packs),
                image_url,
                "",
                card.get("illustrator", ""),
                json.dumps(card),
            ])
            set_ingested += 1
            time.sleep(0.05)

        ingested += set_ingested
        print(f"{set_ingested} cards")

    conn.close()
    print(f"  Saved {ingested} Pocket cards.")
    if pocket_set_fetch_failures or pocket_card_fetch_failures:
        print(
            f"  ({pocket_set_fetch_failures} pocket set fetch error(s), "
            f"{pocket_card_fetch_failures} pocket card fetch error(s) this run.)"
        )
    return ingested, pocket_set_fetch_failures, pocket_card_fetch_failures


# ── Japanese TCG ingestion ───────────────────────────────────────────────


def ingest_japanese_sets() -> None:
    """Fetch Japanese sets from the TCGdex API and upsert into japanese_sets."""
    print("Fetching Japanese sets...")
    resp = httpx.get(f"{TCGDEX_JA_BASE}/sets", timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    data = resp.json()

    sets_list = data if isinstance(data, list) else data.get("sets", [])
    conn = get_connection()
    conn.execute("DELETE FROM japanese_sets")
    count = 0
    for s in sets_list:
        card_count_raw = s.get("cardCount", {})
        if isinstance(card_count_raw, dict):
            card_count = card_count_raw.get("official", card_count_raw.get("total", 0))
        else:
            card_count = int(card_count_raw) if card_count_raw else 0

        conn.execute("""
            INSERT OR REPLACE INTO japanese_sets
                (id, name, series, release_date, card_count, logo_url)
            VALUES (?, ?, ?, ?, ?, ?)
        """, [
            s["id"],
            s.get("name", s["id"]),
            s.get("serie", {}).get("name", "") if isinstance(s.get("serie"), dict) else s.get("serie", ""),
            s.get("releaseDate", ""),
            card_count,
            s.get("logo", ""),
        ])
        count += 1

    conn.close()
    print(f"  Saved {count} Japanese sets.")


def ingest_japanese_cards(force: bool = False) -> tuple[int, int, int]:
    """Fetch Japanese cards from the TCGdex API and upsert into japanese_cards.

    Returns (cards_ingested, japanese_set_fetch_failures, japanese_card_fetch_failures).
    """
    conn = get_connection()

    # Resume check
    if not force:
        result = conn.execute("SELECT COUNT(*) FROM japanese_cards").fetchone()
        existing = result[0] if result else 0
        if existing > 0:
            print(f"Japanese cards: skipped (already have {existing} cards). Use --force to re-download.")
            conn.close()
            return existing, 0, 0

    print("Fetching Japanese cards from TCGdex...")

    resp = httpx.get(f"{TCGDEX_JA_BASE}/sets", timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    data = resp.json()
    sets_list = data if isinstance(data, list) else data.get("sets", [])
    print(f"  Found {len(sets_list)} Japanese sets")

    conn.execute("DELETE FROM japanese_cards")
    ingested = 0
    japanese_set_fetch_failures = 0
    japanese_card_fetch_failures = 0
    for set_idx, set_info in enumerate(sets_list, 1):
        set_id = set_info["id"]
        print(f"  [{set_idx}/{len(sets_list)}] {set_id}...", end=" ", flush=True)

        try:
            set_resp = httpx.get(f"{TCGDEX_JA_BASE}/sets/{quote(set_id, safe='')}", timeout=REQUEST_TIMEOUT)
            set_resp.raise_for_status()
            set_data = set_resp.json()
        except Exception as e:
            japanese_set_fetch_failures += 1
            print(f"failed ({e})")
            continue

        serie_id = (set_data.get("serie") or {}).get("id") or ""
        cards_brief = set_data.get("cards", [])
        set_ingested = 0

        for card_brief in cards_brief:
            card_id = card_brief["id"]

            try:
                card_resp = httpx.get(f"{TCGDEX_JA_BASE}/cards/{quote(card_id, safe='')}", timeout=REQUEST_TIMEOUT)
                card_resp.raise_for_status()
                card = card_resp.json()
            except Exception as e:
                japanese_card_fetch_failures += 1
                print(f"\n    Warning: Failed to fetch {card_id}: {e}")
                time.sleep(0.05)
                continue

            local_id = card.get("localId", "")
            try:
                number = int(local_id)
            except (ValueError, TypeError):
                number = 0

            category = card.get("category", "")
            card_type = category.lower() if category else ""

            types = card.get("types") or []
            element = types[0] if types else ""

            stage_raw = card.get("stage", "")
            stage = stage_raw.lower() if stage_raw else ""

            weaknesses = card.get("weaknesses") or []
            weakness = weaknesses[0].get("type", "") if weaknesses else ""

            image_url = tcgdx_card_high_webp_url(
                card, serie_id=serie_id, set_id=set_id, japanese_locale=True
            )

            conn.execute("""
                INSERT OR REPLACE INTO japanese_cards
                    (id, name, set_id, number, rarity, card_type, element, hp,
                     stage, retreat_cost, weakness, evolves_from, illustrator,
                     image_url, raw_data)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, [
                card_id,
                card.get("name", ""),
                set_id,
                number,
                card.get("rarity", ""),
                card_type,
                element,
                card.get("hp"),
                stage,
                card.get("retreat"),
                weakness,
                card.get("evolveFrom", ""),
                card.get("illustrator", ""),
                image_url,
                json.dumps(card),
            ])
            set_ingested += 1
            time.sleep(0.05)

        ingested += set_ingested
        print(f"{set_ingested} cards")

    conn.close()
    print(f"  Saved {ingested} Japanese cards.")
    if japanese_set_fetch_failures or japanese_card_fetch_failures:
        print(
            f"  ({japanese_set_fetch_failures} Japanese set fetch error(s), "
            f"{japanese_card_fetch_failures} Japanese card fetch error(s) this run.)"
        )
    return ingested, japanese_set_fetch_failures, japanese_card_fetch_failures


# ── Japanese TCG ingestion from PTCG-database ──────────────────────────────

# PTCG-database card_type values mapped to our canonical English enum.
# Some entries are in Japanese, some are already English; handle both.
_CARD_TYPE_MAP: dict[str, str] = {
    "Pokémon": "Pokémon",
    "pokémon": "Pokémon",
    "ポケモン": "Pokémon",
    "トレーナー": "Trainer",
    "サポート": "Trainer",
    "グッズ": "Trainer",
    "ポケモンのどうぐ": "Trainer",
    "スタジアム": "Trainer",
    "エネルギー": "Energy",
    "基本エネルギー": "Energy",
    "特殊エネルギー": "Energy",
}

# PTCG-database stage values mapped from Japanese to English.
# Normalize whitespace before lookup.
_STAGE_MAP: dict[str, str] = {
    "たね": "Basic",
    "1進化": "Stage 1",
    "2進化": "Stage 2",
}

PTCGDB_REPO_API = "https://api.github.com/repos/type-null/PTCG-database"
PTCGDB_RAW = "https://raw.githubusercontent.com/type-null/PTCG-database/main"


def ingest_japanese_set_ptcgdb(set_id: str, json_files: Optional[list[str]] = None) -> int:
    """Fetch Japanese cards for *set_id* from PTCG-database and store in
    ``japanese_cards_ptcgdb``.

    If *json_files* is provided (list of filenames), skips the GitHub API
    directory-listing call entirely.

    IDs are prefixed with ``ptcgdb-`` to avoid overwriting TCGdex rows
    that share the same ``{set_id}-{number}`` convention.

    Returns number of cards ingested.
    """
    conn = get_connection()

    if json_files is None:
        # Standalone mode — list directory via GitHub Contents API.
        dir_url = f"{PTCGDB_REPO_API}/contents/data_jp/{set_id}"
        token = os.environ.get("GITHUB_TOKEN", "")
        headers: dict[str, str] = {"Accept": "application/vnd.github.v3+json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"

        resp = httpx.get(dir_url, headers=headers, timeout=REQUEST_TIMEOUT)
        if resp.status_code == 403:
            print(f"  GitHub API rate-limited listing {set_id}; set GITHUB_TOKEN env var")
            conn.close()
            return 0
        if resp.status_code == 404:
            print(f"  PTCG-database has no data_jp/{set_id}/ directory — skipping")
            conn.close()
            return 0
        resp.raise_for_status()
        entries = resp.json()
        if not isinstance(entries, list):
            print(f"  Unexpected GitHub API response for {set_id} — expected list")
            conn.close()
            return 0
        json_files = [e["name"] for e in entries if e["name"].endswith(".json")]

    # 2. Fetch & parse each card file
    cards_list: list[dict[str, object]] = []
    skipped = 0
    for fname in json_files:
        file_url = f"{PTCGDB_RAW}/data_jp/{set_id}/{fname}"
        try:
            fr = httpx.get(file_url, timeout=REQUEST_TIMEOUT)
            if fr.status_code == 404:
                skipped += 1
                continue
            fr.raise_for_status()
            raw = fr.json()
        except Exception as exc:
            skipped += 1
            print(f"  Skipping {fname}: {exc}")
            continue

        jp_id = raw.get("jp_id")
        number: str = str(raw.get("number") or "")
        set_name = str(raw.get("set_name", "")).lower().strip()

        # card_id = {set_name}-{normalized_number}
        normalized_number = _normalize_jpn_number(number)
        card_id = f"{set_name}-{normalized_number}"
        prefixed_id = f"ptcgdb-{card_id}"

        # card_type — map to English enum
        raw_card_type: str = str(raw.get("card_type") or "")
        card_type = _CARD_TYPE_MAP.get(raw_card_type, raw_card_type) or None

        # rarity — default to "Common" when absent
        rarity: str = str(raw.get("rarity") or "").strip()
        if not rarity:
            rarity = "Common"

        # stage — map Japanese → English
        raw_stage: str = str(raw.get("stage") or "").strip()
        raw_stage = re.sub(r"\s+", "", raw_stage)  # normalize whitespace
        stage = _STAGE_MAP.get(raw_stage, raw_stage) or None

        # types array for JSONB
        types: list[str] = raw.get("types") or []
        element: str = types[0] if types else ""

        # tags → subtypes JSONB array
        tags: list[str] = raw.get("tags") or []
        subtypes: list[str] = tags if isinstance(tags, list) else []

        # author — array → comma-joined
        author = raw.get("author") or []
        illustrator: str = ", ".join(author) if isinstance(author, list) else str(author)

        hp_raw = raw.get("hp")
        hp: str | None = str(hp_raw) if hp_raw is not None else None

        retreat = raw.get("retreat")
        retreat_cost: int | None = int(retreat) if retreat is not None else None

        weakness_data = raw.get("weakness") or {}
        weakness_types: list[str] = weakness_data.get("type") or [] if isinstance(weakness_data, dict) else []
        weakness: str = weakness_types[0] if weakness_types else ""

        evolve_from: str | None = raw.get("evolve_from") or None

        img_url: str = str(raw.get("img") or "")

        # raw_data for jpn_card_key dedup + full source JSON
        raw_data: dict[str, object] = dict(raw)
        raw_data["jpn_card_key"] = _build_jpn_card_key(set_name, number)

        cards_list.append({
            "id": prefixed_id,
            "name": str(raw.get("name") or "Unknown"),
            "set_id": set_name,
            "number": number,
            "rarity": rarity,
            "card_type": card_type,
            "element": element,
            "types": json.dumps(types),
            "subtypes": json.dumps(subtypes),
            "hp": hp,
            "stage": stage,
            "retreat_cost": retreat_cost,
            "weakness": weakness,
            "evolves_from": evolve_from,
            "illustrator": illustrator,
            "image_small": img_url,
            "image_large": img_url,
            "raw_data": json.dumps(raw_data),
        })

    # 3. Upsert into japanese_cards_ptcgdb
    for c in cards_list:
        conn.execute("""
            INSERT OR REPLACE INTO japanese_cards_ptcgdb
                (id, name, set_id, number, rarity, card_type, element, types, subtypes, hp,
                 stage, retreat_cost, weakness, evolves_from, illustrator,
                 image_small, image_large, raw_data)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, [
            c["id"], c["name"], c["set_id"], c["number"], c["rarity"],
            c["card_type"], c["element"], c["types"], c["subtypes"], c["hp"], c["stage"],
            c["retreat_cost"], c["weakness"], c["evolves_from"],
            c["illustrator"], c["image_small"], c["image_large"], c["raw_data"],
        ])

    conn.close()
    total = len(cards_list)
    if skipped:
        print(f"  PTCG-db {set_id}: {total} cards ingested, {skipped} files skipped")
    return total


def ingest_all_japanese_ptcgdb_sets() -> tuple[int, int]:
    """Ingest ALL Japanese sets from PTCG-database.

    Uses a single recursive git-tree API call to discover all files under
    data_jp/ — no GITHUB_TOKEN required (1 API call vs 316).

    Tracks failures in ``failed_sets_ptcgdb`` so they can be retried.

    Returns (total_sets_processed, total_cards_ingested).
    """
    tree_url = f"{PTCGDB_REPO_API}/git/trees/main:data_jp?recursive=1"
    headers: dict[str, str] = {"Accept": "application/vnd.github.v3+json"}

    print("Discovering PTCG-database files (one tree API call)...")
    tree_resp = httpx.get(tree_url, headers=headers, timeout=REQUEST_TIMEOUT)
    if tree_resp.status_code == 403:
        print("GitHub API rate-limited. Wait a few minutes and retry.")
        return (0, 0)
    tree_resp.raise_for_status()
    tree_data = tree_resp.json()
    tree_entries = tree_data.get("tree", [])
    if not tree_entries:
        print("Empty tree response — check repo name / branch.")
        return (0, 0)

    # Group .json files by their parent directory (set_id)
    # Tree paths look like: "SM12a/37205.json", "no_set/foo.json"
    by_set: dict[str, list[str]] = {}
    skipped_no_set = 0
    for item in tree_entries:
        path = item.get("path", "")
        if not path.endswith(".json"):
            continue
        if "/" not in path:
            continue
        dirname, filename = path.split("/", 1)
        if dirname == "no_set":
            skipped_no_set += 1
            continue
        by_set.setdefault(dirname, []).append(filename)

    set_ids = sorted(by_set.keys())
    total_sets = len(set_ids)
    total_files = sum(len(v) for v in by_set.values())
    print(f"Found {total_sets} sets, {total_files} card files ({skipped_no_set} in no_set, skipped)")

    # Clear previous failures so we only track this run
    conn = get_connection()
    conn.execute("DELETE FROM failed_sets_ptcgdb")
    conn.close()

    processed = 0
    total_cards = 0
    for i, sid in enumerate(set_ids):
        pct = (i / total_sets) * 100
        fnames = by_set[sid]
        print(f"[{i + 1}/{total_sets}] {sid} ({pct:.0f}%, {len(fnames)} files) ...", end=" ", flush=True)
        try:
            n = ingest_japanese_set_ptcgdb(sid, json_files=fnames)
            if n > 0:
                print(f"{n} cards")
                total_cards += n
                processed += 1
            else:
                print("0 cards — skipping")
        except Exception as exc:
            reason = str(exc)[:200]
            print(f"FAILED — {reason}")
            c = get_connection()
            c.execute(
                "INSERT OR REPLACE INTO failed_sets_ptcgdb (set_id, reason) VALUES (?, ?)",
                [sid, reason],
            )
            c.close()

    # Final summary
    c = get_connection()
    failures = c.execute("SELECT COUNT(*) FROM failed_sets_ptcgdb").fetchone()[0]
    c.close()

    print()
    print(f"PTCG-database batch complete:")
    print(f"  Sets processed: {processed}/{total_sets}")
    print(f"  Total cards:    {total_cards}")
    if failures:
        print(f"  Failed sets:    {failures} (see failed_sets_ptcgdb)")
    return (processed, total_cards)


def run_ingestion(
    set_id: Optional[str] = None,
    skip_pokemon: bool = False,
    skip_pocket: bool = False,
    skip_tcg: bool = False,
    skip_japanese: bool = False,
    pocket_only: bool = False,
    japanese_only: bool = False,
    japanese_ptcgdb_set: Optional[str] = None,
    japanese_ptcgdb_all: bool = False,
    force: bool = False,
) -> IngestFailureSummary:
    """Run the full ingestion pipeline."""
    stats = IngestFailureSummary()
    initialize_database()

    if japanese_ptcgdb_all:
        try:
            processed, total_cards = ingest_all_japanese_ptcgdb_sets()
            print(f"  Japanese PTCG-db batch: {processed} sets, {total_cards} cards")
            c = get_connection()
            failures = c.execute("SELECT COUNT(*) FROM failed_sets_ptcgdb").fetchone()[0]
            c.close()
            stats.japanese_ptcgdb_failures = failures
        except Exception as e:
            stats.japanese_ptcgdb_failures += 1
            print(f"  Japanese PTCG-db batch: failed — {e}")
        return stats

    if japanese_ptcgdb_set:
        try:
            n = ingest_japanese_set_ptcgdb(japanese_ptcgdb_set)
            print(f"  Japanese PTCG-db cards ({japanese_ptcgdb_set}): {n} rows")
        except Exception as e:
            stats.japanese_ptcgdb_failures += 1
            print(f"  Japanese PTCG-db ({japanese_ptcgdb_set}): failed — {e}")
        return stats

    if pocket_only:
        ingest_pocket_sets()
        _, se, ce = ingest_pocket_cards(force=force)
        stats.pocket_set_fetch_failures = se
        stats.pocket_card_fetch_failures = ce
        return stats

    if japanese_only:
        ingest_japanese_sets()
        _, se, ce = ingest_japanese_cards(force=force)
        stats.japanese_set_fetch_failures = se
        stats.japanese_card_fetch_failures = ce
        return stats

    # Ingest Pokemon metadata first (unless skipped)
    if not skip_pokemon:
        _, pe = ingest_pokemon_metadata(force=force)
        stats.pokemon_species_fetch_failures = pe

    # Ingest main TCG cards (unless skipped)
    if not skip_tcg:
        set_lookup = ingest_sets()
        _, te = ingest_cards(set_lookup, set_id=set_id, force=force)
        stats.tcg_set_fetch_failures = te

    # Ingest Pocket data (unless skipped)
    if not skip_pocket:
        ingest_pocket_sets()
        _, se, ce = ingest_pocket_cards(force=force)
        stats.pocket_set_fetch_failures = se
        stats.pocket_card_fetch_failures = ce

    # Ingest Japanese TCG data (unless skipped)
    if not skip_japanese:
        ingest_japanese_sets()
        _, se, ce = ingest_japanese_cards(force=force)
        stats.japanese_set_fetch_failures = se
        stats.japanese_card_fetch_failures = ce

    return stats


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
        "--skip-pocket",
        dest="skip_pocket",
        action="store_true",
        help="Skip fetching Pokemon TCG Pocket data.",
    )
    parser.add_argument(
        "--skip-tcg",
        dest="skip_tcg",
        action="store_true",
        help="Skip fetching main TCG card data from pokemontcg.io.",
    )
    parser.add_argument(
        "--skip-japanese",
        dest="skip_japanese",
        action="store_true",
        help="Skip fetching Japanese TCG data from TCGdex.",
    )
    parser.add_argument(
        "--pocket",
        dest="pocket_only",
        action="store_true",
        help="Only fetch Pocket data (skip TCG cards and Pokemon metadata).",
    )
    parser.add_argument(
        "--japanese",
        dest="japanese_only",
        action="store_true",
        help="Only fetch Japanese TCG data from TCGdex.",
    )
    parser.add_argument(
        "--japanese-ptcgdb",
        dest="japanese_ptcgdb_set",
        default=None,
        metavar="SET_ID",
        help="Fetch Japanese cards for SET_ID from PTCG-database (e.g. SM12a).",
    )
    parser.add_argument(
        "--japanese-ptcgdb-all",
        dest="japanese_ptcgdb_all",
        action="store_true",
        help="Fetch ALL Japanese sets from PTCG-database (requires GITHUB_TOKEN env var).",
    )
    parser.add_argument(
        "--force",
        dest="force",
        action="store_true",
        help="Force re-download of all sets, even if already in database.",
    )
    parser.add_argument(
        "--clear-failed",
        dest="clear_failed",
        action="store_true",
        help="Clear the permanently-failed sets list before running.",
    )
    parser.add_argument(
        "--normalize-only",
        dest="normalize_only",
        action="store_true",
        help="Only normalize Pokémon supertype variants in tcg_cards to 'Pokémon', then exit.",
    )
    parser.add_argument(
        "--push-supabase",
        dest="push_supabase",
        action="store_true",
        help="After ingest, run push_duckdb_to_supabase.py (set SUPABASE_URL + SUPABASE_SERVICE_KEY).",
    )
    parser.add_argument(
        "--fail-on-partial",
        dest="fail_on_partial",
        action="store_true",
        help="Exit with status 1 if any API step skipped data (TCG sets, PokeAPI species, Pocket, Japanese). For CI.",
    )
    args = parser.parse_args()
    if args.normalize_only:
        conn = get_connection()
        n = normalize_supertypes_in_db(conn)
        conn.close()
        print(f"Normalized {n} supertype variant(s) to 'Pokémon'.")
        return
    if args.clear_failed:
        conn = get_connection()
        deleted = conn.execute("DELETE FROM failed_sets").rowcount
        conn.close()
        print(f"Cleared {deleted} permanently-failed set(s) from the skip list.")
    summary = run_ingestion(
        set_id=args.set_id,
        skip_pokemon=args.skip_pokemon,
        skip_pocket=args.skip_pocket,
        skip_tcg=args.skip_tcg,
        skip_japanese=args.skip_japanese,
        pocket_only=args.pocket_only,
        japanese_only=args.japanese_only,
        japanese_ptcgdb_set=args.japanese_ptcgdb_set,
        japanese_ptcgdb_all=args.japanese_ptcgdb_all,
        force=args.force,
    )

    if args.fail_on_partial and summary.has_partial_failures():
        print(
            "Ingest completed with partial API failures — "
            f"TCG sets: {summary.tcg_set_fetch_failures}, "
            f"PokeAPI species: {summary.pokemon_species_fetch_failures}, "
            f"Pocket sets: {summary.pocket_set_fetch_failures}, "
            f"Pocket cards: {summary.pocket_card_fetch_failures}, "
            f"Japanese sets: {summary.japanese_set_fetch_failures}, "
            f"Japanese cards: {summary.japanese_card_fetch_failures}, "
            f"Japanese PTCG-db: {summary.japanese_ptcgdb_failures}. "
            "Exiting with status 1 (--fail-on-partial).",
            file=sys.stderr,
        )
        sys.exit(1)

    if args.push_supabase:
        push_script = os.path.join(SCRIPT_DIR, "push_duckdb_to_supabase.py")
        rc = subprocess.call([sys.executable, push_script], env=os.environ)
        if rc != 0:
            sys.exit(rc)


if __name__ == "__main__":
    main()
