-- ============================================================
-- 018: Public card share — single-card read for anonymous users
-- ============================================================
-- Used by /share/card/:id and OG HTML. SECURITY DEFINER bypasses
-- RLS; returns only one row by id (no listing).

CREATE OR REPLACE FUNCTION public.get_public_card_for_share(p_card_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r cards%ROWTYPE;
BEGIN
  IF p_card_id IS NULL OR length(trim(p_card_id)) = 0 OR length(p_card_id) > 512 THEN
    RETURN NULL;
  END IF;

  SELECT * INTO r FROM cards WHERE id = trim(p_card_id) LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'id', r.id,
    'name', r.name,
    'set_id', r.set_id,
    'set_name', r.set_name,
    'set_series', r.set_series,
    'number', r.number,
    'origin', r.origin,
    'origin_detail', r.origin_detail,
    'format', r.format,
    'image_small', r.image_small,
    'image_large', r.image_large,
    'supertype', r.supertype,
    'card_type', r.card_type,
    'element', r.element,
    'rarity', r.rarity,
    'artist', r.artist,
    'illustrator', r.illustrator
  );
END;
$$;

COMMENT ON FUNCTION public.get_public_card_for_share(text) IS
  'Read-only single card JSON for public share pages; GRANT to anon for unauthenticated share links.';

GRANT EXECUTE ON FUNCTION public.get_public_card_for_share(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_public_card_for_share(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_card_for_share(text) TO service_role;
