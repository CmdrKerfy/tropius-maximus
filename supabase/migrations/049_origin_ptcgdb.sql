-- ============================================================
-- 049: Add 'ptcgdb' origin for PTCG-database Japanese cards
-- ============================================================
-- Adds 'ptcgdb' to both cards.origin and sets.origin CHECK
-- constraints so PTCG-database-scraped Japanese cards can be
-- ingested alongside tcgdex and manual origins.
--
-- Apply BEFORE first ptcgdb upsert (push_duckdb_to_supabase.py
-- will fail on the origin CHECK otherwise).
-- ============================================================

ALTER TABLE sets DROP CONSTRAINT IF EXISTS chk_sets_origin;
ALTER TABLE sets ADD CONSTRAINT chk_sets_origin
  CHECK (origin IN ('pokemontcg.io', 'tcgdex', 'manual', 'ptcgdb'));

ALTER TABLE cards DROP CONSTRAINT IF EXISTS chk_cards_origin;
ALTER TABLE cards ADD CONSTRAINT chk_cards_origin
  CHECK (origin IN ('pokemontcg.io', 'tcgdex', 'manual', 'ptcgdb'));
