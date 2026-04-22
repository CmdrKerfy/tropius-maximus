-- ============================================================
-- 030: Normalize packed background_details annotation values
-- ============================================================
-- Legacy writes occasionally stored comma-packed values like:
--   ["Island, Stump, Seafloor"]
-- Convert those to normalized arrays while preserving first-seen order.

WITH normalized AS (
  SELECT
    a.card_id,
    COALESCE(
      (
        SELECT jsonb_agg(to_jsonb(d.token) ORDER BY d.first_pos)
        FROM (
          SELECT p.token, MIN(p.pos) AS first_pos
          FROM (
            SELECT
              btrim(piece) AS token,
              ((elem_ord - 1) * 1000 + piece_ord) AS pos
            FROM jsonb_array_elements_text(
              CASE
                WHEN a.background_details IS NULL THEN '[]'::jsonb
                WHEN jsonb_typeof(a.background_details) = 'array' THEN a.background_details
                WHEN jsonb_typeof(a.background_details) = 'string'
                  THEN to_jsonb(ARRAY[a.background_details #>> '{}'])
                ELSE '[]'::jsonb
              END
            ) WITH ORDINALITY AS e(elem_text, elem_ord)
            CROSS JOIN LATERAL regexp_split_to_table(e.elem_text, ',')
              WITH ORDINALITY AS split(piece, piece_ord)
          ) p
          WHERE p.token <> ''
          GROUP BY p.token
        ) d
      ),
      '[]'::jsonb
    ) AS cleaned
  FROM public.annotations a
)
UPDATE public.annotations a
SET background_details = n.cleaned
FROM normalized n
WHERE a.card_id = n.card_id
  AND a.background_details IS DISTINCT FROM n.cleaned;
