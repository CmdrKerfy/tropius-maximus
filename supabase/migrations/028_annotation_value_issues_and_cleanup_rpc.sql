-- ============================================================
-- 028: Data Health annotation value issues + cleanup RPCs
-- ============================================================
-- Read-heavy triage + optional bulk cleanup helpers for annotation array values.
-- Intended for Data Health tooling (non-destructive by default until cleanup RPC called).

CREATE OR REPLACE FUNCTION public.get_annotation_value_issues(
  p_limit int DEFAULT 100,
  p_min_count int DEFAULT 2
)
RETURNS TABLE (
  field_key text,
  field_value text,
  card_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH values_flat AS (
    SELECT 'background_pokemon'::text AS field_key, a.card_id, btrim(v.elem) AS field_value
    FROM public.annotations a
    CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(a.background_pokemon, '[]'::jsonb)) AS v(elem)
    UNION ALL
    SELECT 'background_humans', a.card_id, btrim(v.elem)
    FROM public.annotations a
    CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(a.background_humans, '[]'::jsonb)) AS v(elem)
    UNION ALL
    SELECT 'additional_characters', a.card_id, btrim(v.elem)
    FROM public.annotations a
    CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(a.additional_characters, '[]'::jsonb)) AS v(elem)
    UNION ALL
    SELECT 'background_details', a.card_id, btrim(v.elem)
    FROM public.annotations a
    CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(a.background_details, '[]'::jsonb)) AS v(elem)
    UNION ALL
    SELECT 'emotion', a.card_id, btrim(v.elem)
    FROM public.annotations a
    CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(a.emotion, '[]'::jsonb)) AS v(elem)
    UNION ALL
    SELECT 'pose', a.card_id, btrim(v.elem)
    FROM public.annotations a
    CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(a.pose, '[]'::jsonb)) AS v(elem)
    UNION ALL
    SELECT 'actions', a.card_id, btrim(v.elem)
    FROM public.annotations a
    CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(a.actions, '[]'::jsonb)) AS v(elem)
    UNION ALL
    SELECT 'items', a.card_id, btrim(v.elem)
    FROM public.annotations a
    CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(a.items, '[]'::jsonb)) AS v(elem)
    UNION ALL
    SELECT 'held_item', a.card_id, btrim(v.elem)
    FROM public.annotations a
    CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(a.held_item, '[]'::jsonb)) AS v(elem)
    UNION ALL
    SELECT 'pokeball', a.card_id, btrim(v.elem)
    FROM public.annotations a
    CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(a.pokeball, '[]'::jsonb)) AS v(elem)
    UNION ALL
    SELECT 'evolution_items', a.card_id, btrim(v.elem)
    FROM public.annotations a
    CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(a.evolution_items, '[]'::jsonb)) AS v(elem)
    UNION ALL
    SELECT 'berries', a.card_id, btrim(v.elem)
    FROM public.annotations a
    CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(a.berries, '[]'::jsonb)) AS v(elem)
    UNION ALL
    SELECT 'card_subcategory', a.card_id, btrim(v.elem)
    FROM public.annotations a
    CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(a.card_subcategory, '[]'::jsonb)) AS v(elem)
    UNION ALL
    SELECT 'trainer_card_subgroup', a.card_id, btrim(v.elem)
    FROM public.annotations a
    CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(a.trainer_card_subgroup, '[]'::jsonb)) AS v(elem)
    UNION ALL
    SELECT 'holiday_theme', a.card_id, btrim(v.elem)
    FROM public.annotations a
    CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(a.holiday_theme, '[]'::jsonb)) AS v(elem)
    UNION ALL
    SELECT 'multi_card', a.card_id, btrim(v.elem)
    FROM public.annotations a
    CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(a.multi_card, '[]'::jsonb)) AS v(elem)
    UNION ALL
    SELECT 'video_type', a.card_id, btrim(v.elem)
    FROM public.annotations a
    CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(a.video_type, '[]'::jsonb)) AS v(elem)
    UNION ALL
    SELECT 'video_region', a.card_id, btrim(v.elem)
    FROM public.annotations a
    CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(a.video_region, '[]'::jsonb)) AS v(elem)
    UNION ALL
    SELECT 'video_location', a.card_id, btrim(v.elem)
    FROM public.annotations a
    CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(a.video_location, '[]'::jsonb)) AS v(elem)
  ),
  cleaned AS (
    SELECT field_key, card_id, field_value
    FROM values_flat
    WHERE field_value IS NOT NULL AND field_value <> ''
  )
  SELECT
    c.field_key,
    c.field_value,
    count(DISTINCT c.card_id) AS card_count
  FROM cleaned c
  GROUP BY c.field_key, c.field_value
  HAVING count(DISTINCT c.card_id) >= GREATEST(coalesce(p_min_count, 2), 1)
  ORDER BY card_count DESC, c.field_key, c.field_value
  LIMIT GREATEST(coalesce(p_limit, 100), 0);
$$;

COMMENT ON FUNCTION public.get_annotation_value_issues(int, int) IS
  'Data Health: array annotation values with counts (triage for bad entries).';

CREATE OR REPLACE FUNCTION public.get_cards_for_annotation_value_issue(
  p_field_key text,
  p_value text,
  p_limit int DEFAULT 200
)
RETURNS TABLE (
  id text,
  name text,
  set_id text,
  set_name text,
  number text,
  image_small text,
  origin text
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  allowed text[] := ARRAY[
    'art_style','main_character','background_pokemon','background_humans',
    'additional_characters','background_details','emotion','pose','actions',
    'items','held_item','pokeball','evolution_items','berries',
    'card_subcategory','trainer_card_subgroup','holiday_theme','multi_card',
    'video_type','video_region','video_location'
  ];
  f text := coalesce(p_field_key, '');
  val text := btrim(coalesce(p_value, ''));
  lim int := GREATEST(coalesce(p_limit, 200), 0);
  sql text;
BEGIN
  IF NOT (f = ANY (allowed)) THEN
    RAISE EXCEPTION 'Unsupported field_key: %', f;
  END IF;
  IF val = '' THEN
    RETURN;
  END IF;

  sql := format($Q$
    SELECT c.id, c.name, c.set_id, c.set_name, c.number, c.image_small, c.origin
    FROM public.annotations a
    JOIN public.cards c ON c.id = a.card_id
    WHERE EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(coalesce(a.%1$I, '[]'::jsonb)) e(elem)
      WHERE btrim(e.elem) = $1
    )
    ORDER BY c.set_name, c.number, c.id
    LIMIT $2
  $Q$, f);

  RETURN QUERY EXECUTE sql USING val, lim;
END;
$$;

COMMENT ON FUNCTION public.get_cards_for_annotation_value_issue(text, text, int) IS
  'Data Health: cards currently using one annotation array value.';

CREATE OR REPLACE FUNCTION public.apply_annotation_value_cleanup(
  p_field_key text,
  p_old_value text,
  p_new_value text DEFAULT NULL,
  p_mode text DEFAULT 'replace'
)
RETURNS TABLE (
  updated_rows int
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  allowed text[] := ARRAY[
    'art_style','main_character','background_pokemon','background_humans',
    'additional_characters','background_details','emotion','pose','actions',
    'items','held_item','pokeball','evolution_items','berries',
    'card_subcategory','trainer_card_subgroup','holiday_theme','multi_card',
    'video_type','video_region','video_location'
  ];
  f text := coalesce(p_field_key, '');
  oldv text := btrim(coalesce(p_old_value, ''));
  newv text := btrim(coalesce(p_new_value, ''));
  modev text := lower(coalesce(p_mode, 'replace'));
  sql text;
  rc int := 0;
BEGIN
  IF NOT (f = ANY (allowed)) THEN
    RAISE EXCEPTION 'Unsupported field_key: %', f;
  END IF;
  IF oldv = '' THEN
    RAISE EXCEPTION 'old value is required';
  END IF;
  IF modev NOT IN ('replace', 'remove') THEN
    RAISE EXCEPTION 'mode must be replace or remove';
  END IF;
  IF modev = 'replace' AND newv = '' THEN
    RAISE EXCEPTION 'new value is required for replace mode';
  END IF;

  sql := format($Q$
    UPDATE public.annotations a
    SET %1$I = sub.new_arr,
        version = coalesce(a.version, 0) + 1,
        updated_at = now(),
        updated_by = auth.uid()
    FROM LATERAL (
      SELECT coalesce(
        jsonb_agg(to_jsonb(x.mapped) ORDER BY x.ord),
        '[]'::jsonb
      ) AS new_arr
      FROM (
        SELECT DISTINCT ON (m.mapped)
          m.mapped,
          m.ord
        FROM (
          SELECT
            CASE
              WHEN btrim(e.elem) = $1
                THEN CASE WHEN $2 = 'replace' THEN $3 ELSE NULL END
              ELSE e.elem
            END AS mapped,
            e.ord
          FROM jsonb_array_elements_text(coalesce(a.%1$I, '[]'::jsonb))
            WITH ORDINALITY AS e(elem, ord)
        ) m
        WHERE m.mapped IS NOT NULL
          AND btrim(m.mapped) <> ''
        ORDER BY m.mapped, m.ord
      ) x
    ) sub
    WHERE EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(coalesce(a.%1$I, '[]'::jsonb)) e2(elem)
      WHERE btrim(e2.elem) = $1
    )
  $Q$, f);

  EXECUTE sql USING oldv, modev, newv;
  GET DIAGNOSTICS rc = ROW_COUNT;
  RETURN QUERY SELECT rc;
END;
$$;

COMMENT ON FUNCTION public.apply_annotation_value_cleanup(text, text, text, text) IS
  'Data Health cleanup helper: replace/remove one value across a supported annotation array field.';

GRANT EXECUTE ON FUNCTION public.get_annotation_value_issues(int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_annotation_value_issues(int, int) TO service_role;

GRANT EXECUTE ON FUNCTION public.get_cards_for_annotation_value_issue(text, text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_cards_for_annotation_value_issue(text, text, int) TO service_role;

GRANT EXECUTE ON FUNCTION public.apply_annotation_value_cleanup(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_annotation_value_cleanup(text, text, text, text) TO service_role;
