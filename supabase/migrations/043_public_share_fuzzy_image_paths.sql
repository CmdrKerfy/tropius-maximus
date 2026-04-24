-- ============================================================
-- 043: Public share — more raw_data shapes + scan extra / overrides
-- ============================================================
-- Some API responses wrap card JSON under "data" or set top-level
-- "image". Manual edits may store a URL under a key we did not
-- enumerate. After explicit coalesce, scan annotations.extra and
-- overrides for http(s) values on image-like keys.

CREATE OR REPLACE FUNCTION public.get_public_card_for_share(p_card_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r         cards%ROWTYPE;
  ovr       text;
  ojson     jsonb;
  aextra    jsonb;
  best      text;
  rkey      text;
  rvalue    text;
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
    -- Wrapped / alternate API shapes
    NULLIF(trim(COALESCE(r.raw_data#>>'{data,images,small}', '')), ''),
    NULLIF(trim(COALESCE(r.raw_data#>>'{data,images,large}', '')), ''),
    NULLIF(trim(COALESCE(r.raw_data->>'image', '')), ''),
    NULLIF(trim(COALESCE(r.raw_data#>>'{images,small}', '')), ''),
    NULLIF(trim(COALESCE(r.raw_data#>>'{images,large}', '')), ''),
    NULLIF(trim(COALESCE(r.image_large::text, '')), ''),
    NULLIF(trim(COALESCE(r.image_small::text, '')), '')
  );

  IF best IS NULL THEN
    FOR rkey, rvalue IN
      SELECT t.key, t.value
      FROM (
        SELECT key, value FROM jsonb_each_text(aextra)
        UNION ALL
        SELECT key, value FROM jsonb_each_text(ojson)
      ) t
    LOOP
      IF rkey IS NOT NULL
         AND (rkey ILIKE '%image%' OR rkey ILIKE '%artwork%' OR lower(rkey) = 'url')
         AND rvalue IS NOT NULL
         AND rvalue ~ '^https?://'
         AND char_length(rvalue) < 2000
      THEN
        best := NULLIF(trim(rvalue), '');
        EXIT WHEN best IS NOT NULL;
      END IF;
    END LOOP;
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
  'Public share card JSON; share_preview_image: explicit fields + data.images, raw image, and URL scan of extra/overrides.';
