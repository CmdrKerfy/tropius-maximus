-- ============================================================
-- 056: Streaming RPC + covering index for CJK client-side search
-- ============================================================
-- pg_trgm GIN indexes are ineffective for katakana/CJK text
-- because byte-level trigrams span UTF-8 character boundaries.
-- pg_bigm is not available on Supabase free tier.
--
-- The RPC returns card {id, name} rows as a TABLE (streamed) —
-- no jsonb_agg. The covering index enables an index-only scan,
-- avoiding heap fetches for 19K–60K rows. The app caches the
-- result in TanStack Query (5-min staleTime) and does client-side
-- .includes() matching, passing matched IDs back to the normal
-- PostgREST query via .in("id", ids).

-- Remove previous attempts
DROP FUNCTION IF EXISTS public.get_card_names_by_source(TEXT[], TEXT, TEXT);
DROP FUNCTION IF EXISTS public.find_cjk_card_ids(TEXT[], TEXT, TEXT, TEXT);

-- Index-only scan for the RPC: covers origin, origin_detail, id, name
CREATE INDEX IF NOT EXISTS idx_cards_origin_name_covering
  ON public.cards (origin, origin_detail, id, name);

COMMENT ON INDEX idx_cards_origin_name_covering IS
  '056: covering index for get_card_names_by_source RPC — enables index-only scan for CJK name cache.';

-- Streaming RPC: TABLE return type avoids jsonb_agg entirely.
-- PostgREST streams rows as a JSON array with no aggregation overhead.
CREATE OR REPLACE FUNCTION public.get_card_names_by_source(
  origins TEXT[],
  require_origin_detail TEXT DEFAULT NULL,
  exclude_origin_detail TEXT DEFAULT NULL
)
RETURNS TABLE(id TEXT, name TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT cards.id, cards.name
  FROM cards
  WHERE cards.origin = ANY(origins)
    AND (require_origin_detail IS NULL OR cards.origin_detail = require_origin_detail)
    AND (exclude_origin_detail IS NULL OR cards.origin_detail IS NULL OR cards.origin_detail <> exclude_origin_detail);
$$;

COMMENT ON FUNCTION public.get_card_names_by_source(TEXT[], TEXT, TEXT) IS
  '056: Streaming RPC — returns {id, name} rows for client-side CJK name matching. No JSONB aggregation.';

GRANT EXECUTE ON FUNCTION public.get_card_names_by_source(TEXT[], TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_card_names_by_source(TEXT[], TEXT, TEXT) TO anon;
