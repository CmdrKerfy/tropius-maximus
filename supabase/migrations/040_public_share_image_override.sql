-- ============================================================
-- 040: Public share — include annotation image_override for OG + /share
-- ============================================================
-- Manual cards often store display art only on annotations.image_override
-- while cards.image_* is empty, which broke link previews to blank/SVG.

CREATE OR REPLACE FUNCTION public.get_public_card_for_share(p_card_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r        cards%ROWTYPE;
  ovr      text;
BEGIN
  IF p_card_id IS NULL OR length(trim(p_card_id)) = 0 OR length(p_card_id) > 512 THEN
    RETURN NULL;
  END IF;

  SELECT * INTO r FROM cards WHERE id = trim(p_card_id) LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT a.image_override
    INTO ovr
    FROM annotations a
   WHERE a.card_id = r.id
   LIMIT 1;

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
    'image_override', ovr,
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
  'Read-only single card JSON for public share pages; includes annotations.image_override for artwork when cards.image_* is empty.';
