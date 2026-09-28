-- ============================================================
-- Production-shaped fixture for 2B/2D write-authorization tests
-- ============================================================
-- Captured read-only from production on 2026-09-27 (Postgres 17.6):
-- pg_policies, information_schema.role_table_grants, pg_constraint,
-- pg_get_functiondef for the RPCs below, and auth.uid/role/jwt.
-- Only the objects the 2B/2D migrations touch are reproduced. Columns match
-- production exactly for cards, sets, annotations, edit_history and
-- batch_runs.
--
-- Load into an EMPTY throwaway database as a superuser (see
-- supabase/tests/run_write_authz_tests.sh). Never run against Supabase.

-- ── Supabase roles ──────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END $$;

-- ── auth schema (definitions copied from production) ───────────
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  is_anonymous boolean NOT NULL DEFAULT false
);

CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  select
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$$;

CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- ── Tables ──────────────────────────────────────────────────────
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text
);

CREATE TABLE public.sets (
  id text PRIMARY KEY,
  name text,
  series text,
  printed_total integer,
  total integer,
  release_date date,
  symbol_url text,
  logo_url text,
  card_count integer,
  packs jsonb,
  origin text DEFAULT 'manual',
  CONSTRAINT chk_sets_origin CHECK (origin = ANY (ARRAY['pokemontcg.io', 'tcgdex', 'manual', 'ptcgdb']))
);

CREATE TABLE public.cards (
  id text PRIMARY KEY,
  name text,
  supertype text,
  card_type text,
  subtypes jsonb DEFAULT '[]'::jsonb,
  hp text,
  types jsonb DEFAULT '[]'::jsonb,
  evolves_from text,
  rarity text,
  artist text,
  set_id text REFERENCES public.sets(id),
  number text,
  set_name text,
  set_series text,
  regulation_mark text,
  image_small text,
  image_large text,
  raw_data jsonb DEFAULT '{}'::jsonb,
  prices jsonb DEFAULT '{}'::jsonb,
  evolution_line text,
  element text,
  stage text,
  retreat_cost integer,
  weakness text,
  packs jsonb,
  illustrator text,
  origin text DEFAULT 'manual',
  origin_detail text,
  format text DEFAULT 'printed',
  last_seen_in_api timestamptz,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  number_sort_key integer,
  api_hash text,
  CONSTRAINT cards_id_no_whitespace_chk CHECK ((id = btrim(id)) AND (id !~ '\s'::text)),
  CONSTRAINT chk_cards_format CHECK (format = ANY (ARRAY['printed', 'digital', 'promotional'])),
  CONSTRAINT chk_cards_origin CHECK (origin = ANY (ARRAY['pokemontcg.io', 'tcgdex', 'manual', 'ptcgdb']))
);

CREATE TABLE public.annotations (
  card_id text PRIMARY KEY REFERENCES public.cards(id) ON DELETE CASCADE,
  art_style jsonb DEFAULT '[]'::jsonb,
  main_character jsonb DEFAULT '[]'::jsonb,
  background_pokemon jsonb DEFAULT '[]'::jsonb,
  background_humans jsonb DEFAULT '[]'::jsonb,
  additional_characters jsonb DEFAULT '[]'::jsonb,
  background_details jsonb DEFAULT '[]'::jsonb,
  emotion jsonb DEFAULT '[]'::jsonb,
  pose jsonb DEFAULT '[]'::jsonb,
  actions jsonb DEFAULT '[]'::jsonb,
  items jsonb DEFAULT '[]'::jsonb,
  held_item jsonb DEFAULT '[]'::jsonb,
  pokeball jsonb DEFAULT '[]'::jsonb,
  evolution_items jsonb DEFAULT '[]'::jsonb,
  berries jsonb DEFAULT '[]'::jsonb,
  card_subcategory jsonb DEFAULT '[]'::jsonb,
  trainer_card_subgroup jsonb DEFAULT '[]'::jsonb,
  holiday_theme jsonb DEFAULT '[]'::jsonb,
  multi_card jsonb DEFAULT '[]'::jsonb,
  perspective text,
  weather text,
  environment text,
  storytelling text,
  card_locations text,
  pkmn_region text,
  card_region text,
  primary_color text,
  secondary_color text,
  shape text,
  trainer_card_type text,
  stamp text,
  card_border text,
  energy_type text,
  rival_group text,
  image_override text,
  notes text,
  top_10_themes text,
  wtpc_episode text,
  video_game text,
  video_game_location text,
  video_appearance boolean DEFAULT false,
  shorts_appearance boolean DEFAULT false,
  region_appearance boolean DEFAULT false,
  thumbnail_used boolean DEFAULT false,
  video_url text,
  video_title text,
  video_type jsonb DEFAULT '[]'::jsonb,
  video_region jsonb DEFAULT '[]'::jsonb,
  video_location jsonb DEFAULT '[]'::jsonb,
  pocket_exclusive boolean DEFAULT false,
  owned boolean DEFAULT false,
  extra jsonb DEFAULT '{}'::jsonb,
  overrides jsonb DEFAULT '{}'::jsonb,
  version integer DEFAULT 1,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz DEFAULT now(),
  camera_angle jsonb DEFAULT '[]'::jsonb,
  jumbo_card boolean DEFAULT false,
  CONSTRAINT chk_extra_is_object CHECK (jsonb_typeof(extra) = 'object'),
  CONSTRAINT chk_overrides_is_object CHECK (jsonb_typeof(overrides) = 'object')
);

CREATE TABLE public.batch_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  field_name text,
  card_count integer CHECK (card_count >= 0),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.edit_history (
  id bigint GENERATED BY DEFAULT AS IDENTITY,
  card_id text,
  field_name text,
  old_value text,
  new_value text,
  edited_by uuid REFERENCES auth.users(id),
  edited_at timestamptz DEFAULT now(),
  batch_run_id uuid REFERENCES public.batch_runs(id) ON DELETE SET NULL,
  PRIMARY KEY (id, edited_at)
) PARTITION BY RANGE (edited_at);

-- Wide partitions so the tests never depend on the current quarter.
CREATE TABLE public.edit_history_past PARTITION OF public.edit_history
  FOR VALUES FROM ('2000-01-01+00') TO ('2026-01-01+00');
CREATE TABLE public.edit_history_now PARTITION OF public.edit_history
  FOR VALUES FROM ('2026-01-01+00') TO ('2100-01-01+00');
ALTER TABLE public.edit_history_past ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.edit_history_now ENABLE ROW LEVEL SECURITY;

-- Supabase default privileges: every table fully granted to the API roles.
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;

-- ── Helper + RPCs as deployed ───────────────────────────────────
CREATE FUNCTION public.auth_is_non_anonymous_authenticated()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT auth.role() = 'authenticated'
    AND (auth.jwt()->>'is_anonymous') IS DISTINCT FROM 'true';
$$;

CREATE FUNCTION public.apply_annotation_with_history(p_is_insert boolean, p_expected_version integer, p_row jsonb, p_history jsonb, p_batch_run_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  updated int;
  r annotations%ROWTYPE;
BEGIN
  r := jsonb_populate_record(NULL::annotations, p_row);

  IF p_is_insert THEN
    INSERT INTO annotations
    SELECT * FROM jsonb_populate_record(NULL::annotations, p_row);
  ELSE
    UPDATE annotations AS t
    SET
      (art_style, main_character, background_pokemon, background_humans, additional_characters,
       background_details, emotion, pose, actions, items, held_item, pokeball, evolution_items,
       berries, card_subcategory, trainer_card_subgroup, holiday_theme, multi_card,
       camera_angle, perspective, weather, environment, storytelling, card_locations,
       pkmn_region, card_region, primary_color, secondary_color, shape, trainer_card_type,
       stamp, card_border, energy_type, rival_group, image_override, notes, top_10_themes,
       wtpc_episode, video_game, video_game_location, video_appearance, shorts_appearance,
       region_appearance, thumbnail_used, video_url, video_title, video_type, video_region,
       video_location, pocket_exclusive, owned, extra, overrides, version, updated_by, updated_at)
      = (r.art_style, r.main_character, r.background_pokemon, r.background_humans, r.additional_characters,
         r.background_details, r.emotion, r.pose, r.actions, r.items, r.held_item, r.pokeball,
         r.evolution_items, r.berries, r.card_subcategory, r.trainer_card_subgroup, r.holiday_theme,
         r.multi_card, r.camera_angle, r.perspective, r.weather, r.environment, r.storytelling,
         r.card_locations, r.pkmn_region, r.card_region, r.primary_color, r.secondary_color, r.shape,
         r.trainer_card_type, r.stamp, r.card_border, r.energy_type, r.rival_group, r.image_override,
         r.notes, r.top_10_themes, r.wtpc_episode, r.video_game, r.video_game_location,
         r.video_appearance, r.shorts_appearance, r.region_appearance, r.thumbnail_used, r.video_url,
         r.video_title, r.video_type, r.video_region, r.video_location, r.pocket_exclusive, r.owned,
         r.extra, r.overrides, r.version, r.updated_by, r.updated_at)
    WHERE t.card_id = r.card_id AND t.version = p_expected_version;

    GET DIAGNOSTICS updated = ROW_COUNT;
    IF updated = 0 THEN
      RAISE EXCEPTION 'ANNOTATION_VERSION_CONFLICT: This card was updated elsewhere. Refresh and try again.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_history IS NOT NULL
     AND jsonb_typeof(p_history) = 'array'
     AND jsonb_array_length(p_history) > 0 THEN
    INSERT INTO edit_history (card_id, field_name, old_value, new_value, edited_by, batch_run_id)
    SELECT
      r.card_id,
      (h->>'field_name')::text,
      (h->>'old_value')::text,
      (h->>'new_value')::text,
      auth.uid(),
      p_batch_run_id
    FROM jsonb_array_elements(p_history) AS h;
  END IF;
END;
$function$;

CREATE FUNCTION public.rename_manual_card_with_history(p_card_id text, p_new_name text)
 RETURNS TABLE(card_id text, old_name text, new_name text)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_old_name text;
  v_origin text;
  v_uid uuid;
  v_new_name text;
BEGIN
  IF NOT public.auth_is_non_anonymous_authenticated() THEN
    RAISE EXCEPTION 'Sign in required to rename cards.';
  END IF;

  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in required to rename cards.';
  END IF;

  v_new_name := btrim(coalesce(p_new_name, ''));
  IF v_new_name = '' THEN
    RAISE EXCEPTION 'Card name cannot be empty.';
  END IF;

  SELECT c.name, c.origin
  INTO v_old_name, v_origin
  FROM public.cards AS c
  WHERE c.id = p_card_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Card not found.';
  END IF;

  IF v_origin <> 'manual' THEN
    RAISE EXCEPTION 'Only manual/custom cards can be renamed.';
  END IF;

  IF v_old_name IS NOT DISTINCT FROM v_new_name THEN
    RETURN QUERY SELECT p_card_id, v_old_name, v_old_name;
    RETURN;
  END IF;

  UPDATE public.cards
  SET name = v_new_name
  WHERE id = p_card_id;

  INSERT INTO public.edit_history (card_id, field_name, old_value, new_value, edited_by)
  VALUES (p_card_id, 'card_name', v_old_name, v_new_name, v_uid);

  RETURN QUERY SELECT p_card_id, v_old_name, v_new_name;
END;
$function$;

CREATE FUNCTION public.apply_annotation_value_cleanup(p_field_key text, p_old_value text, p_new_value text DEFAULT NULL::text, p_mode text DEFAULT 'replace'::text)
 RETURNS TABLE(updated_rows integer)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
$function$;

-- ── RLS + policies exactly as in production pg_policies ─────────
ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.annotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.edit_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batch_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read cards" ON public.cards
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated insert cards" ON public.cards
  FOR INSERT WITH CHECK (auth_is_non_anonymous_authenticated());
CREATE POLICY "authenticated update cards" ON public.cards
  FOR UPDATE USING (auth_is_non_anonymous_authenticated());
CREATE POLICY "authenticated delete cards" ON public.cards
  FOR DELETE USING (auth_is_non_anonymous_authenticated());

CREATE POLICY "authenticated read sets" ON public.sets
  FOR SELECT USING ((auth.role() = 'authenticated') AND ((auth.jwt() ->> 'is_anonymous') IS DISTINCT FROM 'true'));
CREATE POLICY "authenticated insert sets" ON public.sets
  FOR INSERT WITH CHECK (auth_is_non_anonymous_authenticated());
CREATE POLICY "authenticated update sets" ON public.sets
  FOR UPDATE USING (auth_is_non_anonymous_authenticated());

CREATE POLICY "authenticated all annotations" ON public.annotations
  FOR ALL USING ((auth.role() = 'authenticated') AND ((auth.jwt() ->> 'is_anonymous') IS DISTINCT FROM 'true'));

CREATE POLICY "authenticated insert edit_history" ON public.edit_history
  FOR INSERT WITH CHECK (auth_is_non_anonymous_authenticated());
CREATE POLICY "authenticated read edit_history" ON public.edit_history
  FOR SELECT USING (auth_is_non_anonymous_authenticated());

CREATE POLICY "users insert own batch_runs" ON public.batch_runs
  FOR INSERT WITH CHECK ((auth.uid() = user_id) AND auth_is_non_anonymous_authenticated());
CREATE POLICY "users read own batch_runs" ON public.batch_runs
  FOR SELECT USING ((auth.uid() = user_id) AND auth_is_non_anonymous_authenticated());

CREATE POLICY "profiles_select_authenticated" ON public.profiles
  FOR SELECT USING (auth_is_non_anonymous_authenticated());

-- ── Seed data ───────────────────────────────────────────────────
-- Users: A and B are signed-in collaborators, Z is an anonymous session.
INSERT INTO auth.users (id, is_anonymous) VALUES
  ('00000000-0000-0000-0000-00000000000a', false),
  ('00000000-0000-0000-0000-00000000000b', false),
  ('00000000-0000-0000-0000-00000000000f', true);
INSERT INTO public.profiles (id, display_name) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'User A'),
  ('00000000-0000-0000-0000-00000000000b', 'User B'),
  ('00000000-0000-0000-0000-00000000000f', 'Anon Z');

INSERT INTO public.sets (id, name, origin) VALUES
  ('sv1', 'Scarlet & Violet', 'pokemontcg.io'),
  ('A1', 'Genetic Apex', 'tcgdex'),
  ('custom-deck', 'Custom Deck', 'manual');

INSERT INTO public.cards (id, name, set_id, number, origin, created_by, api_hash) VALUES
  ('sv1-1',   'Pineco',        'sv1',         '1', 'pokemontcg.io', NULL, 'h1'),
  ('A1-001',  'Bulbasaur',     'A1',          '1', 'tcgdex',        NULL, 'h2'),
  ('custom-deck-1', 'Legacy manual (no creator)', 'custom-deck', '1', 'manual', NULL, NULL),
  ('custom-deck-2', 'Manual by A', 'custom-deck', '2', 'manual', '00000000-0000-0000-0000-00000000000a', NULL),
  ('custom-deck-3', 'Manual by B', 'custom-deck', '3', 'manual', '00000000-0000-0000-0000-00000000000b', NULL),
  ('custom-deck-4', 'Legacy manual 2', 'custom-deck', '4', 'manual', NULL, NULL);

INSERT INTO public.annotations (card_id, notes, version, updated_by) VALUES
  ('sv1-1', 'seed', 3, '00000000-0000-0000-0000-00000000000a'),
  ('custom-deck-4', 'seed', 1, NULL);
UPDATE public.annotations SET art_style = '["Watercolor ", "Sketch"]' WHERE card_id = 'sv1-1';

INSERT INTO public.batch_runs (id, user_id, field_name, card_count) VALUES
  ('11111111-1111-1111-1111-11111111111a', '00000000-0000-0000-0000-00000000000a', 'notes', 1),
  ('11111111-1111-1111-1111-11111111111b', '00000000-0000-0000-0000-00000000000b', 'notes', 1);

-- ── Session helpers for tests ───────────────────────────────────
-- as_user('a' | 'b' | 'anon-jwt' | 'service' | 'signed-out') switches role
-- and JWT claims for the rest of the current transaction.
CREATE FUNCTION public._test_as(p_who text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_who = 'a' THEN
    PERFORM set_config('request.jwt.claims',
      '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000000a","is_anonymous":false}', true);
    SET LOCAL ROLE authenticated;
  ELSIF p_who = 'b' THEN
    PERFORM set_config('request.jwt.claims',
      '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000000b","is_anonymous":false}', true);
    SET LOCAL ROLE authenticated;
  ELSIF p_who = 'anon-jwt' THEN
    PERFORM set_config('request.jwt.claims',
      '{"role":"authenticated","sub":"00000000-0000-0000-0000-00000000000f","is_anonymous":true}', true);
    SET LOCAL ROLE authenticated;
  ELSIF p_who = 'service' THEN
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    SET LOCAL ROLE service_role;
  ELSIF p_who = 'signed-out' THEN
    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
    SET LOCAL ROLE anon;
  ELSE
    RAISE EXCEPTION 'unknown test identity %', p_who;
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public._test_as(text) TO PUBLIC;
