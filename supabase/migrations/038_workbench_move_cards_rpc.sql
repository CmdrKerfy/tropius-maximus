-- ============================================================
-- 038: Atomic Workbench move RPC with 5,000 cap enforcement
-- ============================================================
-- Moves selected cards from one Workbench list to another in one transaction.
-- - Respects existing shared-list visibility rules via SECURITY INVOKER + RLS.
-- - Enforces max target list size (default 5,000).
-- - Leaves overflow cards in the source list when target is at capacity.

CREATE OR REPLACE FUNCTION public.move_workbench_cards(
  p_source_queue_id bigint,
  p_target_queue_id bigint,
  p_card_ids text[],
  p_max_cards integer DEFAULT 5000
)
RETURNS TABLE (
  moved_count integer,
  skipped_existing integer,
  skipped_capacity integer,
  source_count integer,
  target_count integer
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_source public.workbench_queues%ROWTYPE;
  v_target public.workbench_queues%ROWTYPE;
  v_source_ids text[];
  v_target_ids text[];
  v_source_next text[];
  v_target_next text[];
  v_candidate_ids text[] := '{}';
  v_drop_from_source text[] := '{}';
  v_id text;
  v_remaining_slots integer;
  v_source_len integer;
  v_target_len integer;
  v_source_index integer;
  v_target_index integer;
  v_now timestamptz := now();
BEGIN
  IF NOT public.auth_is_non_anonymous_authenticated() THEN
    RAISE EXCEPTION 'Sign in required for Workbench lists.';
  END IF;

  IF p_source_queue_id IS NULL OR p_target_queue_id IS NULL THEN
    RAISE EXCEPTION 'Source and target list ids are required.';
  END IF;

  IF p_source_queue_id = p_target_queue_id THEN
    RAISE EXCEPTION 'Source and target lists must be different.';
  END IF;

  IF p_max_cards IS NULL OR p_max_cards < 1 THEN
    p_max_cards := 5000;
  END IF;

  SELECT *
    INTO v_source
    FROM public.workbench_queues
   WHERE id = p_source_queue_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source Workbench list not found.';
  END IF;

  SELECT *
    INTO v_target
    FROM public.workbench_queues
   WHERE id = p_target_queue_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target Workbench list not found.';
  END IF;

  v_source_ids := ARRAY(
    SELECT DISTINCT trim(x)
      FROM unnest(COALESCE(v_source.card_ids, '{}'::text[])) AS x
     WHERE trim(COALESCE(x, '')) <> ''
  );

  v_target_ids := ARRAY(
    SELECT DISTINCT trim(x)
      FROM unnest(COALESCE(v_target.card_ids, '{}'::text[])) AS x
     WHERE trim(COALESCE(x, '')) <> ''
  );

  v_candidate_ids := ARRAY(
    SELECT DISTINCT trim(x)
      FROM unnest(COALESCE(p_card_ids, '{}'::text[])) AS x
     WHERE trim(COALESCE(x, '')) <> ''
  );

  v_target_next := COALESCE(v_target_ids, '{}'::text[]);
  v_remaining_slots := GREATEST(0, p_max_cards - COALESCE(array_length(v_target_next, 1), 0));
  moved_count := 0;
  skipped_existing := 0;
  skipped_capacity := 0;

  FOREACH v_id IN ARRAY COALESCE(v_candidate_ids, '{}'::text[])
  LOOP
    -- Only cards currently present in source are eligible to move.
    IF NOT (v_id = ANY(COALESCE(v_source_ids, '{}'::text[]))) THEN
      CONTINUE;
    END IF;

    IF v_id = ANY(v_target_next) THEN
      skipped_existing := skipped_existing + 1;
      v_drop_from_source := array_append(v_drop_from_source, v_id);
      CONTINUE;
    END IF;

    IF v_remaining_slots > 0 THEN
      v_target_next := array_append(v_target_next, v_id);
      v_drop_from_source := array_append(v_drop_from_source, v_id);
      v_remaining_slots := v_remaining_slots - 1;
      moved_count := moved_count + 1;
    ELSE
      skipped_capacity := skipped_capacity + 1;
    END IF;
  END LOOP;

  v_source_next := ARRAY(
    SELECT x
      FROM unnest(COALESCE(v_source_ids, '{}'::text[])) AS x
     WHERE NOT (x = ANY(COALESCE(v_drop_from_source, '{}'::text[])))
  );

  v_source_len := COALESCE(array_length(v_source_next, 1), 0);
  v_target_len := COALESCE(array_length(v_target_next, 1), 0);
  source_count := v_source_len;
  target_count := v_target_len;

  v_source_index := LEAST(GREATEST(COALESCE(v_source.current_index, 0), 0), GREATEST(v_source_len - 1, 0));
  v_target_index := LEAST(GREATEST(COALESCE(v_target.current_index, 0), 0), GREATEST(v_target_len - 1, 0));

  UPDATE public.workbench_queues
     SET card_ids = COALESCE(v_source_next, '{}'::text[]),
         current_index = v_source_index,
         updated_at = v_now
   WHERE id = v_source.id;

  UPDATE public.workbench_queues
     SET card_ids = COALESCE(v_target_next, '{}'::text[]),
         current_index = v_target_index,
         updated_at = v_now
   WHERE id = v_target.id;

  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.move_workbench_cards(bigint, bigint, text[], integer)
  TO authenticated, service_role;
