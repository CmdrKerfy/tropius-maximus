-- ============================================================
-- 026: Manual card ID cleanup + prevent whitespace in `cards.id`
-- ============================================================
-- Problem: Legacy `cards.id` values with leading/trailing/internal spaces
-- (pre-`strip_custom_card_ids.py`) can coexist with canonical rows after
-- `migrate_data.py` upserts, causing duplicate Explore tiles for the same promo.
--
-- Strategy (manual / origin = manual only):
-- 1) Group duplicates by (set_id, name, primary artwork URL) — same as app
--    `exploreGridRowDedupeKey` — avoids merging different promos that share a
--    normalized id string (e.g. Reshiram vs legacy Tepig id).
-- 2) Keep one row per group: prefer `id = normalize_card_id(id)`, then shorter
--    `id`, then lexicographic min.
-- 3) Rewire `annotations` (move row if keeper has none; else drop loser row),
--    `edit_history`, `workbench_queues.card_ids`, `batch_selections.card_ids`.
-- 4) Delete loser `cards` rows.
-- 5) CHECK on `cards.id`: no whitespace (matches app + JSON hygiene).
--
-- PRE-FLIGHT (run in Supabase SQL editor on a copy / before apply):
--   See block at bottom: inspect `dup_manual_cards` without changing data.
--
-- Rollback: not automated; restore from backup if needed.

-- ------------------------------------------------------------------
-- 1) Normalization helper (same semantics as scripts/strip_custom_card_ids.py)
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_card_id(p_id text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT regexp_replace(
    regexp_replace(
      btrim(regexp_replace(coalesce(p_id, ''), E'\\s+', '-', 'g')),
      '-+',
      '-',
      'g'
    ),
    '^-+|-+$',
    '',
    'g'
  );
$$;

COMMENT ON FUNCTION public.normalize_card_id(text) IS
  'Collapse whitespace in card id to hyphens (legacy cleanup); keep in sync with scripts/strip_custom_card_ids.py.';

GRANT EXECUTE ON FUNCTION public.normalize_card_id(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_card_id(text) TO service_role;

-- ------------------------------------------------------------------
-- 2) Build loser -> keeper map (fingerprints with non-empty artwork URL only)
-- ------------------------------------------------------------------
CREATE TEMP TABLE _manual_card_dedupe_map (old_id text PRIMARY KEY, new_id text NOT NULL) ON COMMIT DROP;

WITH manual AS (
  SELECT
    id,
    lower(btrim(set_id)) AS k_sid,
    lower(btrim(regexp_replace(coalesce(name, ''), E'\\s+', ' ', 'g'))) AS k_nm,
    lower(
      btrim(
        coalesce(
          nullif(btrim(coalesce(image_large, '')), ''),
          nullif(btrim(coalesce(image_small, '')), '')
        )
      )
    ) AS k_img
  FROM public.cards
  WHERE origin = 'manual'
),
grouped AS (
  SELECT
    array_agg(
      id
      ORDER BY
        CASE WHEN id = public.normalize_card_id(id) THEN 0 ELSE 1 END,
        char_length(id),
        id
    ) AS ids
  FROM manual
  WHERE k_img IS NOT NULL
    AND k_img <> ''
  GROUP BY k_sid, k_nm, k_img
  HAVING count(*) > 1
),
pairs AS (
  SELECT
    (ids)[1] AS keep_id,
    x.loser_id
  FROM grouped g
  CROSS JOIN LATERAL (
    SELECT unnest((g.ids)[2 : array_upper(g.ids, 1)]) AS loser_id
  ) x
)
INSERT INTO _manual_card_dedupe_map (old_id, new_id)
SELECT loser_id, keep_id
FROM pairs
WHERE loser_id IS DISTINCT FROM keep_id;

-- ------------------------------------------------------------------
-- 3) Rewire references and delete duplicate manual cards
-- ------------------------------------------------------------------
DO $$
DECLARE
  r record;
  wq record;
  bsel record;
  e text;
  v text;
  vals text[];
  new_j jsonb;
BEGIN
  FOR r IN SELECT old_id, new_id FROM _manual_card_dedupe_map
  LOOP
    -- Annotations: move loser row onto keeper if keeper has none; else drop loser row.
    IF EXISTS (SELECT 1 FROM public.annotations WHERE card_id = r.old_id) THEN
      IF NOT EXISTS (SELECT 1 FROM public.annotations WHERE card_id = r.new_id) THEN
        UPDATE public.annotations
        SET card_id = r.new_id
        WHERE card_id = r.old_id;
      ELSE
        DELETE FROM public.annotations WHERE card_id = r.old_id;
      END IF;
    END IF;

    -- edit_history has no FK to cards; keep audit trail pointing at canonical id.
    UPDATE public.edit_history
    SET card_id = r.new_id
    WHERE card_id = r.old_id;

    -- Workbench queues: JSONB array of string ids (006). Replace + order-preserving dedupe.
    FOR wq IN
      SELECT id, card_ids
      FROM public.workbench_queues
      WHERE card_ids @> to_jsonb(r.old_id)
    LOOP
      vals := ARRAY[]::text[];
      FOR e IN SELECT jsonb_array_elements_text(wq.card_ids)
      LOOP
        v := CASE WHEN e = r.old_id THEN r.new_id ELSE e END;
        IF NOT (v = ANY (vals)) THEN
          vals := array_append(vals, v);
        END IF;
      END LOOP;
      SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
      INTO new_j
      FROM unnest(vals) AS x;
      UPDATE public.workbench_queues
      SET card_ids = new_j
      WHERE id = wq.id;
    END LOOP;

    -- Batch selections: TEXT[] (024). Replace + order-preserving dedupe.
    FOR bsel IN
      SELECT user_id, card_ids
      FROM public.batch_selections
      WHERE r.old_id = ANY (card_ids)
    LOOP
      vals := ARRAY[]::text[];
      FOR e IN SELECT unnest(bsel.card_ids)
      LOOP
        v := CASE WHEN e = r.old_id THEN r.new_id ELSE e END;
        IF NOT (v = ANY (vals)) THEN
          vals := array_append(vals, v);
        END IF;
      END LOOP;
      UPDATE public.batch_selections
      SET card_ids = vals
      WHERE user_id = bsel.user_id;
    END LOOP;
  END LOOP;
END $$;

DELETE FROM public.cards c
USING _manual_card_dedupe_map m
WHERE c.id = m.old_id;

-- ------------------------------------------------------------------
-- 4) Prevent future whitespace in primary keys (all origins)
-- ------------------------------------------------------------------
ALTER TABLE public.cards
  ADD CONSTRAINT cards_id_no_whitespace_chk
  CHECK (
    id = btrim(id)
    AND id !~ E'\\s'
  );

COMMENT ON CONSTRAINT cards_id_no_whitespace_chk ON public.cards IS
  'Reject card ids with leading/trailing/internal whitespace (align with strip_custom_card_ids.py + Explore dedupe).';

-- ------------------------------------------------------------------
-- 5) PRE-FLIGHT query (copy into SQL editor before applying migration)
-- ------------------------------------------------------------------
-- WITH manual AS (
--   SELECT id, set_id, name, image_small, image_large,
--          lower(btrim(set_id)) AS k_sid,
--          lower(btrim(regexp_replace(coalesce(name, ''), E'\\s+', ' ', 'g'))) AS k_nm,
--          lower(btrim(coalesce(nullif(btrim(coalesce(image_large, '')), ''),
--                                nullif(btrim(coalesce(image_small, '')), '')))) AS k_img
--   FROM public.cards WHERE origin = 'manual'
-- ),
-- grouped AS (
--   SELECT k_sid, k_nm, k_img, array_agg(id ORDER BY id) AS ids, count(*) AS n
--   FROM manual
--   WHERE k_img IS NOT NULL AND k_img <> ''
--   GROUP BY k_sid, k_nm, k_img
--   HAVING count(*) > 1
-- )
-- SELECT * FROM grouped ORDER BY k_sid, k_nm;
