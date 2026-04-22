-- ============================================================
-- 034: Manual card rename RPC + edit_history row
-- ============================================================

CREATE OR REPLACE FUNCTION public.rename_manual_card_with_history(
  p_card_id text,
  p_new_name text
) RETURNS TABLE(card_id text, old_name text, new_name text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
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
$$;

COMMENT ON FUNCTION public.rename_manual_card_with_history(text, text) IS
  'Renames manual/custom cards only and logs card_name change to edit_history.';

GRANT EXECUTE ON FUNCTION public.rename_manual_card_with_history(text, text) TO authenticated;
