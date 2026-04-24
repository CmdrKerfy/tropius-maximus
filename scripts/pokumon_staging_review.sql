-- Phase 2 staging review SQL (run in Supabase SQL editor).
-- This script creates a staging table and review queries only.
-- It does not insert into production cards/annotations tables.

create table if not exists public.staging_pokumon_cards (
  record_id text primary key,
  wp_post_id bigint not null,
  name text not null,
  title_raw text,
  detail_raw text,
  number_guess text,
  set_name_guess text,
  language jsonb not null default '[]'::jsonb,
  artist jsonb not null default '[]'::jsonb,
  holofoil jsonb not null default '[]'::jsonb,
  release_event jsonb not null default '[]'::jsonb,
  release_year jsonb not null default '[]'::jsonb,
  release_month jsonb not null default '[]'::jsonb,
  release_type jsonb not null default '[]'::jsonb,
  card_type jsonb not null default '[]'::jsonb,
  additional_attributes jsonb not null default '[]'::jsonb,
  cardname jsonb not null default '[]'::jsonb,
  prefix jsonb not null default '[]'::jsonb,
  suffix jsonb not null default '[]'::jsonb,
  media_meta jsonb not null default '{}'::jsonb,
  image_url text,
  source_link text,
  slug text,
  origin text not null default 'manual',
  origin_detail text not null default 'pokumon',
  is_promo boolean not null default true,
  raw_date_gmt text,
  raw_modified_gmt text,
  imported_at timestamptz not null default now()
);

alter table public.staging_pokumon_cards add column if not exists release_year jsonb not null default '[]'::jsonb;
alter table public.staging_pokumon_cards add column if not exists release_month jsonb not null default '[]'::jsonb;
alter table public.staging_pokumon_cards add column if not exists release_type jsonb not null default '[]'::jsonb;
alter table public.staging_pokumon_cards add column if not exists card_type jsonb not null default '[]'::jsonb;
alter table public.staging_pokumon_cards add column if not exists additional_attributes jsonb not null default '[]'::jsonb;
alter table public.staging_pokumon_cards add column if not exists cardname jsonb not null default '[]'::jsonb;
alter table public.staging_pokumon_cards add column if not exists prefix jsonb not null default '[]'::jsonb;
alter table public.staging_pokumon_cards add column if not exists suffix jsonb not null default '[]'::jsonb;
alter table public.staging_pokumon_cards add column if not exists media_meta jsonb not null default '{}'::jsonb;
alter table public.staging_pokumon_cards add column if not exists raw_date_gmt text;

-- Optional reset for repeated pilot runs:
-- truncate table public.staging_pokumon_cards;

-- Review 1: key uniqueness checks
select
  count(*) as total_rows,
  count(distinct record_id) as distinct_record_id,
  count(distinct wp_post_id) as distinct_wp_post_id,
  count(distinct slug) as distinct_slug
from public.staging_pokumon_cards;

-- Review 2: potentially ambiguous duplicates for import matching
select
  number_guess,
  set_name_guess,
  language,
  count(*) as n
from public.staging_pokumon_cards
group by 1,2,3
having count(*) > 1
order by n desc, number_guess;

-- Review 3: image/null quality checks
select
  count(*) filter (where coalesce(trim(image_url), '') = '') as missing_image,
  count(*) filter (where coalesce(trim(number_guess), '') = '') as missing_number
from public.staging_pokumon_cards;

-- Review 4: sample rows to eyeball before pilot insert
select
  record_id,
  name,
  number_guess,
  set_name_guess,
  language,
  image_url
from public.staging_pokumon_cards
order by imported_at desc, record_id
limit 25;
