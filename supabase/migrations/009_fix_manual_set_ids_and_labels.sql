-- ============================================================
-- 009: Manual (custom) sets — fix stub names (name = id) and
--      split ambiguous set_id values (bjp, sjp, …).
-- Safe for TCG/Pocket sets: only touches origin = 'manual' cards
-- and inserts/updates manual set rows.
-- ============================================================

-- Canonical manual set rows (merge with existing)
INSERT INTO sets (id, name, origin, series) VALUES
  ('bjp-base', 'Base Japanese Promos', 'manual', NULL),
  ('bjp-bw', 'BW Japanese Promos', 'manual', NULL),
  ('custom-jp-promos-xy', 'XY Japanese Promos', 'manual', NULL),
  ('sjp-sm', 'SM Japanese Promos', 'manual', NULL),
  ('sjp-swsh', 'SWSH JP Promos', 'manual', NULL),
  ('sjp-sv', 'SV JP Promos', 'manual', NULL)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  series = COALESCE(sets.series, EXCLUDED.series);

-- Split / rename cards (manual only)
UPDATE cards SET set_id = 'bjp-base', set_name = 'Base Japanese Promos'
WHERE origin = 'manual' AND set_id = 'bjp' AND trim(set_name) = 'Base Japanese Promos';

UPDATE cards SET set_id = 'bjp-bw', set_name = 'BW Japanese Promos'
WHERE origin = 'manual' AND set_id = 'bjp' AND trim(set_name) = 'BW Japanese Promos';

UPDATE cards SET set_id = 'bjp-base', set_name = 'Base Japanese Promos'
WHERE origin = 'manual' AND set_id = 'custom-jp-promos' AND trim(set_name) = 'Base Japanese Promos';

UPDATE cards SET set_id = 'custom-jp-promos-xy', set_name = 'XY Japanese Promos'
WHERE origin = 'manual' AND set_id = 'custom-jp-promos' AND trim(set_name) = 'XY Japanese Promos';

UPDATE cards SET set_name = 'CN Promos'
WHERE origin = 'manual' AND set_id = 'custom-cn-promos';

UPDATE cards SET set_name = 'KR Promos'
WHERE origin = 'manual' AND set_id = 'custom-kr-promos';

UPDATE cards SET set_id = 'sjp-sm', set_name = 'SM Japanese Promos'
WHERE origin = 'manual' AND set_id = 'sjp' AND trim(set_name) = 'SM Japanese Promos';

UPDATE cards SET set_id = 'sjp-swsh', set_name = 'SWSH JP Promos'
WHERE origin = 'manual' AND set_id = 'sjp' AND trim(set_name) = 'SWSH JP Promos';

UPDATE cards SET set_id = 'sjp-sv', set_name = 'SV JP Promos'
WHERE origin = 'manual' AND set_id = 'sjp' AND trim(set_name) = 'SV JP Promos';

UPDATE cards SET set_name = 'XY'
WHERE origin = 'manual' AND set_id = 'x' AND lower(trim(set_name)) = 'xy';

-- Sync sets.name from cards for all manual sets still referenced (fixes gc, paa, ejp, …)
UPDATE sets s
SET name = c.set_name
FROM (
  SELECT DISTINCT ON (set_id)
    set_id,
    set_name
  FROM cards
  WHERE origin = 'manual'
    AND set_id IS NOT NULL
    AND set_name IS NOT NULL
    AND trim(set_name) <> ''
  ORDER BY set_id, set_name
) c
WHERE s.id = c.set_id
  AND s.origin = 'manual';

-- Remove obsolete manual set rows no longer referenced by any card
DELETE FROM sets s
WHERE s.origin = 'manual'
  AND s.id IN ('bjp', 'sjp')
  AND NOT EXISTS (SELECT 1 FROM cards c WHERE c.set_id = s.id);
