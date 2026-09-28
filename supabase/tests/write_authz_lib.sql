-- Probe helpers for write_authz.test.sql. Load after the fixture.
--
-- _probe(who, sql, check) runs `sql` as `who` (see _test_as in the fixture)
-- inside a subtransaction, then evaluates the boolean `check` as the
-- superuser, then rolls everything back. Returns
--   'ok:<rows>'            statement succeeded (rows = ROW_COUNT)
--   'ok:<rows>:<check>'    ... and the check evaluated to true/false/null
--   'err:<sqlstate>:<msg>' statement failed
-- Every probe starts from the seeded state.

CREATE FUNCTION public._probe(p_who text, p_sql text, p_check text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  n bigint;
  ok boolean;
  res text;
BEGIN
  BEGIN
    PERFORM public._test_as(p_who);
    EXECUTE p_sql;
    GET DIAGNOSTICS n = ROW_COUNT;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
    IF p_check IS NULL THEN
      res := 'ok:' || n;
    ELSE
      EXECUTE 'SELECT (' || p_check || ')::boolean' INTO ok;
      res := 'ok:' || n || ':' || coalesce(ok::text, 'null');
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'ZZ999', MESSAGE = res;
  EXCEPTION
    WHEN SQLSTATE 'ZZ999' THEN
      RETURN SQLERRM;
    WHEN OTHERS THEN
      RETURN 'err:' || SQLSTATE || ':' || SQLERRM;
  END;
END $$;

CREATE TABLE public._results (
  seq serial,
  label text,
  got text,
  want text,
  pass boolean
);

CREATE FUNCTION public._expect(p_label text, p_got text, p_want text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public._results (label, got, want, pass)
  VALUES (p_label, p_got, p_want, p_got LIKE p_want);
END $$;
