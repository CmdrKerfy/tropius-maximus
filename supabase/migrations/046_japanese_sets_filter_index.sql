-- ============================================================
-- 046: Index for source-scoped set filtering
-- ============================================================
-- Speeds up queries that filter sets by whether they have cards
-- for a given origin + origin_detail combination (used by
-- get_explore_filter_options_db RPC and client-paged fallback).
-- SECURITY INVOKER: respects RLS.

CREATE INDEX IF NOT EXISTS idx_cards_origin_detail_set
  ON cards (origin, origin_detail, set_id);

COMMENT ON INDEX idx_cards_origin_detail_set IS
  'Supports source-scoped set filtering: distinct set_id lookups by origin + origin_detail.';
