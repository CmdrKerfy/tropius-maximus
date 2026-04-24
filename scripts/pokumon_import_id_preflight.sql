-- Preflight before running pokumon_phase3_pilot_insert.sql (or a full import).
-- Finds staging record_ids that already exist in public.cards as a *different* kind of row
-- (same primary key = Phase 3 ON CONFLICT DO UPDATE would overwrite that card).
--
-- Run after staging is loaded, before Phase 3 insert.
-- Expect 0 rows for a safe import. Any rows returned need a decision (skip, rename id, or merge).

select
  s.record_id as staging_record_id,
  c.id as existing_card_id,
  c.name as existing_name,
  c.origin,
  c.origin_detail,
  c.created_by,
  c.created_at,
  coalesce(c.raw_data->>'source_site', '') as existing_raw_source_site
from public.staging_pokumon_cards s
inner join public.cards c on c.id = s.record_id
where
  -- Would not be a no-op "already pokumon" refresh you intend to allow:
  c.origin_detail is distinct from 'pokumon'
  or coalesce(c.raw_data->>'source_site', '') is distinct from 'pokumon.com';

-- Summary count only:
-- select count(*) as conflict_rows
-- from public.staging_pokumon_cards s
-- inner join public.cards c on c.id = s.record_id
-- where c.origin_detail is distinct from 'pokumon'
--    or coalesce(c.raw_data->>'source_site', '') is distinct from 'pokumon.com';
