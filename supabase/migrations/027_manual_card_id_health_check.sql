-- ============================================================
-- 027: Data Health check — manual card id canonical drift (read-only)
-- ============================================================
-- Non-blocking visibility: report manual/custom card ids that do not match
-- the canonical generator shape from `016_generate_card_id_manual.sql`.

CREATE OR REPLACE FUNCTION public.get_manual_card_id_health_issues(p_limit int DEFAULT 25)
RETURNS TABLE (
  total_issues bigint,
  id text,
  set_id text,
  number text,
  expected_id text,
  issue text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH manual AS (
    SELECT
      c.id,
      c.set_id,
      c.number,
      'custom-' ||
      lower(trim(coalesce(c.set_id, ''))) ||
      '-' ||
      CASE
        WHEN ltrim(trim(coalesce(c.number, '')), '0') = '' THEN '0'
        ELSE ltrim(trim(coalesce(c.number, '')), '0')
      END AS expected_id
    FROM public.cards c
    WHERE c.origin = 'manual'
  ),
  flagged AS (
    SELECT
      m.id,
      m.set_id,
      m.number,
      m.expected_id,
      CASE
        WHEN trim(coalesce(m.set_id, '')) = '' THEN 'missing_set_id'
        WHEN trim(coalesce(m.number, '')) = '' THEN 'missing_number'
        WHEN m.id !~ '^custom-' THEN 'legacy_prefix'
        WHEN m.id <> m.expected_id THEN 'non_canonical'
        ELSE NULL
      END AS issue
    FROM manual m
  ),
  issues AS (
    SELECT *
    FROM flagged
    WHERE issue IS NOT NULL
  )
  SELECT
    count(*) OVER () AS total_issues,
    i.id,
    i.set_id,
    i.number,
    i.expected_id,
    i.issue
  FROM issues i
  ORDER BY i.issue, i.set_id, i.number, i.id
  LIMIT GREATEST(coalesce(p_limit, 25), 0);
$$;

COMMENT ON FUNCTION public.get_manual_card_id_health_issues(int) IS
  'Read-only Data Health check: manual cards whose id does not match canonical custom-{set}-{number}.';

GRANT EXECUTE ON FUNCTION public.get_manual_card_id_health_issues(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_manual_card_id_health_issues(int) TO service_role;
