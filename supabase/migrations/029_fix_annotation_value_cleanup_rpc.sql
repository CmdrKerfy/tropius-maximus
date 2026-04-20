-- ============================================================
-- 029: Fix apply_annotation_value_cleanup target-table reference
-- ============================================================
-- 028 used UPDATE ... FROM LATERAL with target alias "a" referenced inside
-- the lateral subquery, which fails on Postgres with:
--   invalid reference to FROM-clause entry for table "a"
--
-- Keep behavior identical (replace/remove + dedupe + preserve first-seen order)
-- but compute the new array with a correlated subquery in SET.

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
    SET %1$I = (
          SELECT coalesce(
            jsonb_agg(to_jsonb(d.mapped) ORDER BY d.first_ord),
            '[]'::jsonb
          )
          FROM (
            SELECT
              m.mapped,
              min(m.ord) AS first_ord
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
            GROUP BY m.mapped
          ) d
        ),
        version = coalesce(a.version, 0) + 1,
        updated_at = now(),
        updated_by = auth.uid()
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

GRANT EXECUTE ON FUNCTION public.apply_annotation_value_cleanup(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_annotation_value_cleanup(text, text, text, text) TO service_role;
