-- ============================================================
-- 037: Workbench list owner controls (server-side enforcement)
-- ============================================================
-- Goal:
-- - Collaborators can edit shared list contents (`card_ids`, `current_index`).
-- - Only owners can change list metadata (`name`, `fields`, `filters_used`, `is_shared`) or delete lists.
-- This complements UI guards with DB-side enforcement.

CREATE OR REPLACE FUNCTION public.enforce_workbench_list_owner_controls()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
BEGIN
  IF auth.role() = 'service_role' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF NOT public.auth_is_non_anonymous_authenticated() THEN
    RAISE EXCEPTION 'Sign in required for Workbench lists.';
  END IF;

  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in required for Workbench lists.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF v_uid <> OLD.user_id THEN
      RAISE EXCEPTION 'Only the list owner can delete this list.';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE path
  IF v_uid = OLD.user_id THEN
    RETURN NEW;
  END IF;

  -- Non-owner updates are limited to list content fields only.
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.name IS DISTINCT FROM OLD.name
     OR NEW.fields IS DISTINCT FROM OLD.fields
     OR NEW.filters_used IS DISTINCT FROM OLD.filters_used
     OR NEW.is_shared IS DISTINCT FROM OLD.is_shared THEN
    RAISE EXCEPTION 'Only the list owner can change list settings.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_workbench_list_owner_controls
  ON public.workbench_queues;

CREATE TRIGGER trg_enforce_workbench_list_owner_controls
BEFORE UPDATE OR DELETE ON public.workbench_queues
FOR EACH ROW
EXECUTE FUNCTION public.enforce_workbench_list_owner_controls();
