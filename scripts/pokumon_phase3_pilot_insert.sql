-- Phase 3: Pilot insert from staging -> cards (Supabase SQL editor)
-- Safe scope:
-- - Inserts only rows currently in public.staging_pokumon_cards
-- - Uses deterministic card IDs from staging.record_id
-- - Adds batch metadata for rollback/audit
--
-- Prereq:
-- 1) scripts/pokumon_staging_review.sql (table + checks)
-- 2) tmp/pokumon_staging_load.sql (pilot rows loaded)

begin;

-- Batch marker for this pilot run (edit label per run if desired)
with settings as (
  select 'pokumon-pilot-2026-04-24'::text as batch_id
),
set_rows as (
  select
    'pokumon-' || lower(regexp_replace(coalesce(nullif(trim(set_name_guess), ''), 'unknown'), '[^a-z0-9]+', '-', 'g')) as set_id,
    coalesce(nullif(trim(set_name_guess), ''), 'Unknown Promo Set') as set_name
  from public.staging_pokumon_cards
  group by 1, 2
)
insert into public.sets (id, name, origin)
select sr.set_id, sr.set_name, 'manual'
from set_rows sr
on conflict (id) do update
set name = excluded.name;

with settings as (
  select 'pokumon-pilot-2026-04-24'::text as batch_id
)
insert into public.cards (
  id,
  name,
  set_id,
  number,
  set_name,
  image_small,
  image_large,
  raw_data,
  prices,
  origin,
  origin_detail,
  format
)
select
  s.record_id as id,
  s.name,
  'pokumon-' || lower(regexp_replace(coalesce(nullif(trim(s.set_name_guess), ''), 'unknown'), '[^a-z0-9]+', '-', 'g')) as set_id,
  nullif(trim(s.number_guess), '') as number,
  coalesce(nullif(trim(s.set_name_guess), ''), 'Unknown Promo Set') as set_name,
  nullif(trim(s.image_url), '') as image_small,
  nullif(trim(s.image_url), '') as image_large,
  jsonb_build_object(
    'source_site', 'pokumon.com',
    'source_type', 'promo_archive',
    'source_post_id', s.wp_post_id,
    'source_link', s.source_link,
    'source_slug', s.slug,
    'pilot_batch_id', st.batch_id,
    'language', coalesce(s.language, '[]'::jsonb),
    'artist', coalesce(s.artist, '[]'::jsonb),
    'holofoil', coalesce(s.holofoil, '[]'::jsonb),
    'release_event', coalesce(s.release_event, '[]'::jsonb),
    'release_year', coalesce(s.release_year, '[]'::jsonb),
    'release_month', coalesce(s.release_month, '[]'::jsonb),
    'release_type', coalesce(s.release_type, '[]'::jsonb),
    'card_type', coalesce(s.card_type, '[]'::jsonb),
    'additional_attributes', coalesce(s.additional_attributes, '[]'::jsonb),
    'cardname', coalesce(s.cardname, '[]'::jsonb),
    'prefix', coalesce(s.prefix, '[]'::jsonb),
    'suffix', coalesce(s.suffix, '[]'::jsonb),
    'media_meta', coalesce(s.media_meta, '{}'::jsonb),
    'source_date_gmt', nullif(trim(s.raw_date_gmt), ''),
    'source_modified_gmt', nullif(trim(s.raw_modified_gmt), ''),
    'is_promo', true
  ) as raw_data,
  '{}'::jsonb as prices,
  'manual' as origin,
  'pokumon' as origin_detail,
  'promotional' as format
from public.staging_pokumon_cards s
cross join settings st
on conflict (id) do update
set
  name = excluded.name,
  set_id = excluded.set_id,
  number = excluded.number,
  set_name = excluded.set_name,
  image_small = excluded.image_small,
  image_large = excluded.image_large,
  raw_data = excluded.raw_data,
  origin = excluded.origin,
  origin_detail = excluded.origin_detail,
  format = excluded.format;

-- Post-insert check
select
  count(*) as inserted_or_updated_cards
from public.cards
where origin = 'manual'
  and origin_detail = 'pokumon'
  and coalesce(raw_data->>'pilot_batch_id', '') = 'pokumon-pilot-2026-04-24';

commit;

-- Rollback (run manually if needed):
-- begin;
-- delete from public.cards
-- where origin = 'manual'
--   and origin_detail = 'pokumon'
--   and coalesce(raw_data->>'pilot_batch_id', '') = 'pokumon-pilot-2026-04-24';
-- commit;
