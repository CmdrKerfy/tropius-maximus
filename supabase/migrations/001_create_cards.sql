-- ============================================================
-- 001: Core card and set tables
-- ============================================================

-- Sets (unified: TCG + Pocket + manual)
CREATE TABLE sets (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  series        TEXT,
  printed_total INT,
  total         INT,
  release_date  DATE,
  symbol_url    TEXT,
  logo_url      TEXT,
  card_count    INT,                -- used by Pocket sets
  packs         JSONB,              -- used by Pocket sets
  origin        TEXT NOT NULL DEFAULT 'manual',

  CONSTRAINT chk_sets_origin CHECK (origin IN ('pokemontcg.io', 'tcgdex', 'manual'))
);

-- Cards (unified: TCG + Pocket + manual)
CREATE TABLE cards (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  supertype       TEXT,               -- Pokémon, Trainer, Energy (TCG)
  card_type       TEXT,               -- Pokemon, Item, Supporter (Pocket)
  subtypes        JSONB DEFAULT '[]',
  hp              TEXT,
  types           JSONB DEFAULT '[]',
  evolves_from    TEXT,
  rarity          TEXT,
  artist          TEXT,
  set_id          TEXT REFERENCES sets(id),
  number          TEXT,
  set_name        TEXT,               -- denormalized (immutable)
  set_series      TEXT,               -- denormalized (immutable)
  regulation_mark TEXT,
  image_small     TEXT,
  image_large     TEXT,
  raw_data        JSONB DEFAULT '{}',
  prices          JSONB DEFAULT '{}',
  evolution_line  TEXT,               -- denormalized (static)

  -- Pocket-specific (NULL for TCG cards)
  element         TEXT,
  stage           TEXT,
  retreat_cost    INT,
  weakness        TEXT,
  packs           JSONB,
  illustrator     TEXT,

  -- Provenance
  origin          TEXT NOT NULL DEFAULT 'manual',
  origin_detail   TEXT,
  format          TEXT NOT NULL DEFAULT 'printed',
  last_seen_in_api TIMESTAMPTZ,

  -- Audit
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT chk_cards_origin CHECK (origin IN ('pokemontcg.io', 'tcgdex', 'manual')),
  CONSTRAINT chk_cards_format CHECK (format IN ('printed', 'digital', 'promotional'))
);

-- Pokemon species metadata (from PokeAPI)
CREATE TABLE pokemon_metadata (
  pokedex_number    INT PRIMARY KEY,
  name              TEXT,
  region            TEXT,
  generation        INT,
  color             TEXT,
  shape             TEXT,
  genus             TEXT,
  encounter_location TEXT,
  evolution_chain   JSONB
);

-- Indexes for common queries
CREATE INDEX idx_cards_set_id ON cards(set_id);
CREATE INDEX idx_cards_name ON cards(name);
CREATE INDEX idx_cards_origin ON cards(origin);
CREATE INDEX idx_cards_format ON cards(format);
CREATE INDEX idx_cards_artist ON cards(artist);
CREATE INDEX idx_cards_rarity ON cards(rarity);
CREATE INDEX idx_cards_supertype ON cards(supertype);

-- Auto-create set stubs to prevent FK violations
CREATE OR REPLACE FUNCTION ensure_set_exists(
  p_set_id TEXT,
  p_set_name TEXT DEFAULT NULL,
  p_origin TEXT DEFAULT 'manual'
) RETURNS VOID AS $$
BEGIN
  INSERT INTO sets (id, name, origin)
  VALUES (p_set_id, COALESCE(p_set_name, p_set_id), p_origin)
  ON CONFLICT (id) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- Server-side card ID generation
CREATE OR REPLACE FUNCTION generate_card_id(
  p_set_id TEXT,
  p_number TEXT
) RETURNS TEXT AS $$
DECLARE
  normalized_number TEXT;
  final_id TEXT;
BEGIN
  -- Normalize: trim whitespace, strip leading zeros
  normalized_number := LTRIM(TRIM(p_number), '0');
  IF normalized_number = '' THEN normalized_number := '0'; END IF;

  -- Build ID
  final_id := LOWER(TRIM(p_set_id)) || '-' || normalized_number;

  -- Check collision
  IF EXISTS (SELECT 1 FROM cards WHERE id = final_id) THEN
    RAISE EXCEPTION 'Card ID "%" already exists', final_id;
  END IF;

  RETURN final_id;
END;
$$ LANGUAGE plpgsql;
