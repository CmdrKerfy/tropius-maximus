-- ============================================================
-- 022: Explore grid — search + filter indexes (Phase 2)
-- ============================================================
-- Speeds ilike('%query%') on cards.name (pg_trgm) and common
-- origin + set_id filters. Safe to apply on large tables (non-concurrent
-- in migration transaction — brief lock; use off-peak if needed).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram GIN: accelerates ILIKE '%...%' on name (Explore search).
CREATE INDEX IF NOT EXISTS idx_cards_name_trgm
  ON public.cards
  USING gin (name gin_trgm_ops);

-- Composite: matches typical filtered grid (source scoping + set filter).
CREATE INDEX IF NOT EXISTS idx_cards_origin_set_id
  ON public.cards (origin, set_id);

COMMENT ON INDEX idx_cards_name_trgm IS
  'Phase 2 Explore: faster name search (ilike %%) via pg_trgm.';
COMMENT ON INDEX idx_cards_origin_set_id IS
  'Phase 2 Explore: origin + set_id filter combinations.';
