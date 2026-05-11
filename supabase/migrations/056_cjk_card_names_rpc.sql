-- ============================================================
-- 056: RPC to fetch card names by origin for client-side CJK search
-- ============================================================
-- pg_trgm GIN indexes are ineffective for katakana/CJK text
-- because byte-level trigrams span UTF-8 character boundaries.
-- pg_bigm is not available on Supabase free tier.
--
-- This RPC returns {id, name} for all cards in a given origin
-- set. The app caches the result (5-min staleTime) and does
-- client-side .includes() matching, passing matched IDs back
-- to the normal PostgREST query via .in("id", ids). This
-- preserves all existing filter, sort, and pagination logic
-- while eliminating the CJK ILIKE sequential scan entirely.

CREATE OR REPLACE FUNCTION public.get_card_names_by_source(
  origins TEXT[],
  require_origin_detail TEXT DEFAULT NULL,
  exclude_origin_detail TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object('id', id, 'name', name)),
    '[]'::jsonb
  )
  FROM cards
  WHERE origin = ANY(origins)
    AND (require_origin_detail IS NULL OR origin_detail = require_origin_detail)
    AND (exclude_origin_detail IS NULL OR origin_detail IS NULL OR origin_detail <> exclude_origin_detail);
$$;

COMMENT ON FUNCTION public.get_card_names_by_source(TEXT[], TEXT, TEXT) IS
  '056: Returns {id, name}[] for cards matching origin/detail filters. Used for client-side CJK name search.';

GRANT EXECUTE ON FUNCTION public.get_card_names_by_source(TEXT[], TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_card_names_by_source(TEXT[], TEXT, TEXT) TO anon;
