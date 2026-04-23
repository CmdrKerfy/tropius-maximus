-- ============================================================
-- 042: Public share — image from extra, raw_data, overrides variants
-- ============================================================
-- Some cards store artwork only in annotations.extra, or only in
-- cards.raw_data (API "images" shape), or overrides use camelCase keys.
-- Extends share_preview_image coalesce (replaces 041’s definition in full).

CREATE OR REPLACE FUNCTION public.get_public_card_for_share(p_card_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r      cards%ROWTYPE;
  ovr    text;
  ojson  jsonb;
  aextra jsonb;
  best   text;
BEGIN
  IF p_card_id IS NULL OR length(trim(p_card_id)) = 0 OR length(p_card_id) > 512 THEN
    RETURN NULL;
  END IF;

  SELECT * INTO r FROM cards WHERE id = trim(p_card_id) LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT
    a.image_override,
    COALESCE(a.overrides, '{}'::jsonb),
    COALESCE(a.extra, '{}'::jsonb)
  INTO ovr, ojson, aextra
  FROM annotations a
  WHERE a.card_id = r.id
  LIMIT 1;

  ojson := COALESCE(ojson, '{}'::jsonb);
  aextra := COALESCE(aextra, '{}'::jsonb);

  best := COALESCE(
    NULLIF(trim(ovr), ''),
    NULLIF(trim(COALESCE(ojson->>'image_large', '')), ''),
    NULLIF(trim(COALESCE(ojson->>'image_small', '')), ''),
    NULLIF(trim(COALESCE(ojson->>'imageLarge', '')), ''),
    NULLIF(trim(COALESCE(ojson->>'imageSmall', '')), ''),
    NULLIF(trim(COALESCE(aextra->>'image_url', '')), ''),
    NULLIF(trim(COALESCE(aextra->>'image_large', '')), ''),
    NULLIF(trim(COALESCE(aextra->>'image_small', '')), ''),
    NULLIF(trim(COALESCE(aextra->>'image', '')), ''),
    NULLIF(trim(COALESCE(aextra->>'artwork', '')), ''),
    NULLIF(trim(COALESCE(r.raw_data#>>'{images,small}', '')), ''),
    NULLIF(trim(COALESCE(r.raw_data#>>'{images,large}', '')), ''),
    NULLIF(trim(COALESCE(r.image_large::text, '')), ''),
    NULLIF(trim(COALESCE(r.image_small::text, '')), '')
  );

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
    'share_preview_image', best,
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
  'Public share card JSON; share_preview_image coalesces image_override, overrides, extra, raw_data.images, and cards.image_*..';
