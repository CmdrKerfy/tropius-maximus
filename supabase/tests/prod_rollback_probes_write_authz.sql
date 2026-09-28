-- ============================================================
-- 2B/2D production probes: real policies, JWT identity, ALWAYS rolled back
-- ============================================================
-- Owner approval required before each run (it attempts writes, then
-- undoes them). Run as ONE statement via the Supabase MCP execute_sql tool
-- or the SQL editor. Nothing can commit:
--   * each probe runs in its own subtransaction that always raises;
--   * the block ends with RAISE EXCEPTION, which aborts the whole
--     transaction and carries the results in the error message.
-- Locks: each probe row-locks one card/annotation/set for milliseconds.
-- Do not run while the ingest workflow is pushing.
--
-- Identity: the signed-in user who created the most manual cards (A) and
-- another non-anonymous user (B), read from public.profiles/auth.users.
-- Targets: one pokemontcg.io card that has an annotation, and its set.
--
-- Expected before 2B/2D (today): P1-P9 all "ok" (holes open).
-- Expected after 2B + 2D: P1 42501, P2 ok:0, P3 42501, P4 42501, P5 42501,
--   P6 22023, P7 ok (updated_by = A), P8 42501, P9 42501, P10 P0001.

DO $probe$
DECLARE
  a uuid;
  b uuid;
  api_card text;
  api_set text;
  ver int;
  n bigint;
  who text;
  out text := '';
BEGIN
  SELECT created_by INTO a FROM public.cards
   WHERE origin = 'manual' AND created_by IS NOT NULL
   GROUP BY created_by ORDER BY count(*) DESC LIMIT 1;
  SELECT u.id INTO b FROM auth.users u JOIN public.profiles p ON p.id = u.id
   WHERE NOT coalesce(u.is_anonymous, false) AND u.id <> a LIMIT 1;
  SELECT c.id, c.set_id, an.version INTO api_card, api_set, ver
    FROM public.cards c JOIN public.annotations an ON an.card_id = c.id
   WHERE c.origin = 'pokemontcg.io' ORDER BY c.id LIMIT 1;
  IF a IS NULL OR api_card IS NULL THEN
    RAISE EXCEPTION 'probe setup failed: a=% card=%', a, api_card;
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('role', 'authenticated', 'sub', a, 'is_anonymous', false)::text, true);

  -- P1 PATCH an API card
  BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE public.cards SET name = name || ' probe' WHERE id = api_card;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE EXCEPTION USING ERRCODE = 'ZZ999', MESSAGE = 'ok:' || n;
  EXCEPTION WHEN OTHERS THEN
    out := out || 'P1 update API card: ' || CASE WHEN SQLSTATE = 'ZZ999' THEN SQLERRM ELSE SQLSTATE || ' ' || SQLERRM END || E'\n';
  END;

  -- P2 DELETE an API card (would cascade its annotation)
  BEGIN
    SET LOCAL ROLE authenticated;
    DELETE FROM public.cards WHERE id = api_card;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE EXCEPTION USING ERRCODE = 'ZZ999', MESSAGE = 'ok:' || n;
  EXCEPTION WHEN OTHERS THEN
    out := out || 'P2 delete API card: ' || CASE WHEN SQLSTATE = 'ZZ999' THEN SQLERRM ELSE SQLSTATE || ' ' || SQLERRM END || E'\n';
  END;

  -- P3 INSERT an API-origin card
  BEGIN
    SET LOCAL ROLE authenticated;
    INSERT INTO public.cards (id, name, set_id, origin, created_by)
    VALUES ('probe-2b-api', 'Probe', api_set, 'pokemontcg.io', a);
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE EXCEPTION USING ERRCODE = 'ZZ999', MESSAGE = 'ok:' || n;
  EXCEPTION WHEN OTHERS THEN
    out := out || 'P3 insert API-origin card: ' || CASE WHEN SQLSTATE = 'ZZ999' THEN SQLERRM ELSE SQLSTATE || ' ' || SQLERRM END || E'\n';
  END;

  -- P4 INSERT a manual card credited to someone else
  BEGIN
    SET LOCAL ROLE authenticated;
    INSERT INTO public.cards (id, name, set_id, origin, created_by)
    VALUES ('probe-2b-manual', 'Probe', api_set, 'manual', coalesce(b, a));
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE EXCEPTION USING ERRCODE = 'ZZ999', MESSAGE = 'ok:' || n || CASE WHEN b IS NULL THEN ' (no user B; credited to A)' ELSE '' END;
  EXCEPTION WHEN OTHERS THEN
    out := out || 'P4 insert manual card for B: ' || CASE WHEN SQLSTATE = 'ZZ999' THEN SQLERRM ELSE SQLSTATE || ' ' || SQLERRM END || E'\n';
  END;

  -- P5 PATCH an API set
  BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE public.sets SET name = name || ' probe' WHERE id = api_set;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE EXCEPTION USING ERRCODE = 'ZZ999', MESSAGE = 'ok:' || n;
  EXCEPTION WHEN OTHERS THEN
    out := out || 'P5 update API set: ' || CASE WHEN SQLSTATE = 'ZZ999' THEN SQLERRM ELSE SQLSTATE || ' ' || SQLERRM END || E'\n';
  END;

  -- P6 RPC save with a forged version jump
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.apply_annotation_with_history(false, ver,
      (SELECT to_jsonb(an) || jsonb_build_object('version', ver + 1000)
         FROM public.annotations an WHERE an.card_id = api_card),
      '[]'::jsonb);
    RESET ROLE;
    SELECT version INTO n FROM public.annotations WHERE card_id = api_card;
    RAISE EXCEPTION USING ERRCODE = 'ZZ999', MESSAGE = 'ok: version now ' || n;
  EXCEPTION WHEN OTHERS THEN
    out := out || 'P6 RPC forged version: ' || CASE WHEN SQLSTATE = 'ZZ999' THEN SQLERRM ELSE SQLSTATE || ' ' || SQLERRM END || E'\n';
  END;

  -- P7 RPC save crediting someone else
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.apply_annotation_with_history(false, ver,
      (SELECT to_jsonb(an) || jsonb_build_object('version', ver + 1, 'updated_by', coalesce(b, a),
                                                 'updated_at', '2000-01-01T00:00:00Z')
         FROM public.annotations an WHERE an.card_id = api_card),
      '[]'::jsonb);
    RESET ROLE;
    SELECT CASE WHEN updated_by = a THEN 'A' WHEN updated_by = b THEN 'B' ELSE 'other' END
           || ' at ' || updated_at INTO who
      FROM public.annotations WHERE card_id = api_card;
    RAISE EXCEPTION USING ERRCODE = 'ZZ999', MESSAGE = 'ok: updated_by ' || who;
  EXCEPTION WHEN OTHERS THEN
    out := out || 'P7 RPC forged updated_by: ' || CASE WHEN SQLSTATE = 'ZZ999' THEN SQLERRM ELSE SQLSTATE || ' ' || SQLERRM END || E'\n';
  END;

  -- P8 direct history insert credited to someone else
  BEGIN
    SET LOCAL ROLE authenticated;
    INSERT INTO public.edit_history (card_id, field_name, new_value, edited_by)
    VALUES (api_card, 'probe', 'x', coalesce(b, a));
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE EXCEPTION USING ERRCODE = 'ZZ999', MESSAGE = 'ok:' || n;
  EXCEPTION WHEN OTHERS THEN
    out := out || 'P8 insert history for B: ' || CASE WHEN SQLSTATE = 'ZZ999' THEN SQLERRM ELSE SQLSTATE || ' ' || SQLERRM END || E'\n';
  END;

  -- P9 direct annotation delete
  BEGIN
    SET LOCAL ROLE authenticated;
    DELETE FROM public.annotations WHERE card_id = api_card;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE EXCEPTION USING ERRCODE = 'ZZ999', MESSAGE = 'ok:' || n;
  EXCEPTION WHEN OTHERS THEN
    out := out || 'P9 delete annotation: ' || CASE WHEN SQLSTATE = 'ZZ999' THEN SQLERRM ELSE SQLSTATE || ' ' || SQLERRM END || E'\n';
  END;

  -- P10 optimistic lock still works (stale expected version)
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.apply_annotation_with_history(false, ver - 1,
      (SELECT to_jsonb(an) || jsonb_build_object('version', ver)
         FROM public.annotations an WHERE an.card_id = api_card),
      '[]'::jsonb);
    RAISE EXCEPTION USING ERRCODE = 'ZZ999', MESSAGE = 'ok (no conflict raised!)';
  EXCEPTION WHEN OTHERS THEN
    out := out || 'P10 stale version: ' || CASE WHEN SQLSTATE = 'ZZ999' THEN SQLERRM ELSE SQLSTATE || ' ' || left(SQLERRM, 40) END || E'\n';
  END;

  RAISE EXCEPTION E'PROBE RESULTS (rolled back; card %)\n%', api_card, out;
END
$probe$;
