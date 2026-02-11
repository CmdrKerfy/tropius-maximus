# Data Dictionary

This document describes the database schema for the Pokemon TCG Database.

## Overview

The database contains five tables:
- **cards** — All Pokemon Trading Card Game cards (from pokemontcg.io)
- **sets** — TCG card set metadata
- **pokemon_metadata** — Pokemon species data from PokeAPI
- **pocket_cards** — Pokemon TCG Pocket cards (from flibustier GitHub DB)
- **pocket_sets** — Pokemon TCG Pocket set metadata

Data is stored as Parquet files and loaded into DuckDB-WASM at runtime.

---

## Tables

### cards

Primary table storing all Pokemon Trading Card Game cards.

| Column | Type | Description |
|--------|------|-------------|
| `id` | VARCHAR (PK) | Unique card ID from API (e.g., "xy1-1") |
| `name` | VARCHAR | Card name |
| `supertype` | VARCHAR | Pokemon / Trainer / Energy |
| `subtypes` | VARCHAR | JSON array (e.g., `["Stage 1"]`) |
| `hp` | VARCHAR | Hit points (string; some cards have none) |
| `types` | VARCHAR | JSON array of types (e.g., `["Fire"]`) |
| `evolves_from` | VARCHAR | Name of Pokemon this evolves from |
| `rarity` | VARCHAR | Rarity (Rare, Uncommon, Common, etc.) |
| `artist` | VARCHAR | Card artist name |
| `set_id` | VARCHAR | Foreign key to sets table |
| `set_name` | VARCHAR | Set display name |
| `set_series` | VARCHAR | Series name |
| `number` | VARCHAR | Card number in set |
| `regulation_mark` | VARCHAR | Tournament regulation mark |
| `image_small` | VARCHAR | Small image URL |
| `image_large` | VARCHAR | Large image URL |
| `raw_data` | JSON | Complete API response for the card |
| `prices` | JSON | Price data (see format below) |
| `annotations` | JSON | User metadata (see format below) |

#### JSON Column Formats

**prices**
```json
{
  "tcgplayer": {
    "url": "https://...",
    "updatedAt": "2024-01-15",
    "prices": {
      "holofoil": { "low": 1.50, "mid": 2.00, "high": 5.00, "market": 1.75 }
    }
  },
  "cardmarket": {
    "url": "https://...",
    "updatedAt": "2024-01-15",
    "prices": { "averageSellPrice": 1.80, "lowPrice": 1.20 }
  }
}
```

**annotations** (user-editable, stored in IndexedDB)
```json
{
  "notes": "My favorite card!",
  "rating": 5,
  "condition": "Near Mint",
  "owned": true
}
```

---

### sets

Lookup table for card sets.

| Column | Type | Description |
|--------|------|-------------|
| `id` | VARCHAR (PK) | Set ID (e.g., "sv1", "xy1") |
| `name` | VARCHAR | Set name (e.g., "Scarlet & Violet") |
| `series` | VARCHAR | Series name (e.g., "Scarlet & Violet") |
| `printed_total` | INTEGER | Number of cards printed in set |
| `total` | INTEGER | Total unique cards including secrets |
| `release_date` | VARCHAR | Release date (YYYY/MM/DD) |
| `symbol_url` | VARCHAR | URL to set symbol image |
| `logo_url` | VARCHAR | URL to set logo image |

---

### pokemon_metadata

Pokemon species data from PokeAPI for enriching card information.

| Column | Type | Description |
|--------|------|-------------|
| `pokedex_number` | INTEGER (PK) | National Pokedex number |
| `name` | VARCHAR | Pokemon name |
| `region` | VARCHAR | Origin region (Kanto, Johto, Hoenn, etc.) |
| `generation` | INTEGER | Generation number (1-9) |
| `color` | VARCHAR | Primary color |
| `shape` | VARCHAR | Body shape category |
| `genus` | VARCHAR | Species category (e.g., "Lizard Pokemon") |
| `encounter_location` | VARCHAR | First encounter location |
| `evolution_chain` | VARCHAR | JSON array of evolution names |

#### evolution_chain Format
```json
["Charmander", "Charmeleon", "Charizard"]
```

---

### pocket_sets

Lookup table for Pokemon TCG Pocket sets, sourced from the [flibustier/pokemon-tcg-pocket-database](https://github.com/flibustier/pokemon-tcg-pocket-database) GitHub repo.

| Column | Type | Description |
|--------|------|-------------|
| `id` | VARCHAR (PK) | Set code (e.g., "A1", "A1a", "PROMO-A") |
| `name` | VARCHAR | English set name (e.g., "Genetic Apex") |
| `series` | VARCHAR | Series identifier ("A" or "B") |
| `release_date` | VARCHAR | Release date (YYYY-MM-DD) |
| `card_count` | INTEGER | Number of cards in the set |
| `packs` | JSON | Array of pack names (e.g., `["Charizard", "Mewtwo", "Pikachu"]`) |
| `logo_url` | VARCHAR | URL to set logo image |

---

### pocket_cards

All Pokemon TCG Pocket cards, with enrichment data from `cards.extra.json` where available.

| Column | Type | Description |
|--------|------|-------------|
| `id` | VARCHAR (PK) | Constructed ID: `{set}-{number:03d}` (e.g., "A1-001") |
| `name` | VARCHAR | Card name |
| `set_id` | VARCHAR | Foreign key to pocket_sets.id |
| `number` | INTEGER | Card number within set |
| `rarity` | VARCHAR | Rarity code (C, U, R, RR, AR, SR, SAR, IM, UR) |
| `card_type` | VARCHAR | Card type from enrichment (e.g., "pokemon", "supporter", "Fossil") |
| `element` | VARCHAR | Element/energy type from enrichment (e.g., "grass", "fire") |
| `hp` | INTEGER | Hit points from enrichment |
| `stage` | VARCHAR | Evolution stage, normalized (e.g., "basic", "stage 1", "stage 2") |
| `retreat_cost` | INTEGER | Retreat cost from enrichment |
| `weakness` | VARCHAR | Weakness type from enrichment (e.g., "Fire") |
| `evolves_from` | VARCHAR | Name of Pokemon this evolves from (enrichment) |
| `packs` | JSON | Array of pack names this card appears in |
| `image_url` | VARCHAR | Full constructed image URL |
| `image_filename` | VARCHAR | Original image filename from source |
| `raw_data` | JSON | Merged data from cards.json + cards.extra.json |
| `annotations` | JSON | User metadata (same format as cards table, runtime only) |

**Note:** Columns marked "from enrichment" are nullable — enrichment data currently only covers some sets.

---

## Data Pipeline

1. **Ingest** (`scripts/ingest.py`)
   - Fetches card data from Pokemon TCG API (pokemontcg.io)
   - Fetches Pokemon metadata from PokeAPI
   - Fetches Pokemon TCG Pocket data from flibustier GitHub DB
   - Stores in local DuckDB for processing

2. **Export** (`scripts/export_parquet.py`)
   - Exports tables to Parquet files with ZSTD compression
   - Output: `public/data/*.parquet`

3. **Runtime** (`src/db.js`)
   - DuckDB-WASM loads Parquet files via HTTP
   - User annotations stored in IndexedDB (write-through)

---

## Notes

- **VARCHAR for HP**: Some cards (Trainers, Energy) have no HP value
- **JSON arrays as strings**: DuckDB-WASM handles JSON parsing at query time
- **Annotations persistence**: User data survives page reloads via IndexedDB
- **BigInt conversion**: DuckDB-WASM returns BigInt for integers; convert with `Number()` for JSON serialization
