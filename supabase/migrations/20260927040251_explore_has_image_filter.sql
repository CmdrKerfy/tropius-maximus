-- ============================================================
-- Explore "Has Image" filter: count user image overrides; fast "No"
-- ============================================================
-- Explore's Has Image filter (v2 7eafda2) checks only cards.image_small /
-- image_large. A user can also give any card a picture through Card Detail's
-- image override (annotations.image_override), and the grid shows that first
-- (CardGrid: image_override || image_small || image_large). On 2026-09-27 no
-- card relied on an override alone (4 overrides, all on cards with images),
-- but the Japanese Neo cards whose wrong images were cleared are the likely
-- ones to be filled in by hand.
--
-- 1. card_has_image_override(cards): a PostgREST computed field, so the
--    filter can say "card image OR override" in one request:
--      Yes: or=(image_small.not.is.null,image_large.not.is.null,
--               card_has_image_override.is.true)
--      No:  image_small=is.null&image_large=is.null
--           &card_has_image_override=is.false
--    SECURITY INVOKER: the caller's RLS on annotations applies, so it sees
--    exactly the overrides the grid would show. Unnamed parameter so it is a
--    computed field, not an RPC. Blank / whitespace overrides count as none
--    (the grid treats "" as no override).
--
-- 2. idx_cards_no_image: partial index over the ~4.3k cards with no image
--    of their own. Measured 2026-09-27 (postgres, cached, Source = All): the
--    "No" count seq-scanned all ~59k rows in 2.9-5.3 s (8 s statement
--    timeout), and a "No" page at offset 2000 took 1.5 s. With the index the
--    planner reads only those rows. The "Yes" count still scans (4.6 s,
--    same as without the override check); the "Yes" grid page is ~11 ms.
--
-- Applied 2026-09-27 (owner-approved) as SQL via the Supabase MCP tool; not in
-- the migration history table. Post-apply: index 224 kB; No count 523 ms via
-- idx_cards_no_image (was 2.9-5.3 s); No 4,338 + Yes 54,888 = 59,226.
--
-- Not CONCURRENTLY: the index is built from ~4.3k matching rows of a ~59k
-- row table; the build takes seconds and only blocks writes to cards.
--
-- Rollback:
--   drop index if exists public.idx_cards_no_image;
--   drop function if exists public.card_has_image_override(public.cards);
--   notify pgrst, 'reload schema';
--   (and redeploy the app without card_has_image_override in the filter)
--
-- Check after applying:
--   select indexdef from pg_indexes where indexname = 'idx_cards_no_image';
--   explain analyze select count(*) from public.cards c
--    where c.origin in ('pokemontcg.io','manual','tcgdex','ptcgdb')
--      and c.image_small is null and c.image_large is null
--      and not public.card_has_image_override(c);
--   -- expect Index (Only) Scan / Bitmap scan on idx_cards_no_image, tens of ms

create index if not exists idx_cards_no_image
  on public.cards (name, id)
  where image_small is null and image_large is null;

create or replace function public.card_has_image_override(public.cards)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.annotations a
    where a.card_id = $1.id
      and nullif(btrim(a.image_override), '') is not null
  );
$$;

comment on function public.card_has_image_override(public.cards) is
  'Explore Has Image filter: true when the card has a non-blank annotations.image_override (PostgREST computed field).';

revoke execute on function public.card_has_image_override(public.cards) from public, anon;
grant execute on function public.card_has_image_override(public.cards) to authenticated, service_role;

notify pgrst, 'reload schema';
