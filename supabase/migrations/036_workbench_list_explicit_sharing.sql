-- ============================================================
-- 036: Workbench lists explicit sharing visibility
-- ============================================================
-- v2 behavior:
-- - Lists are private by default (owner-only visibility).
-- - Other authenticated collaborators can see/edit a list only when `is_shared = true`.

ALTER TABLE public.workbench_queues
  ADD COLUMN IF NOT EXISTS is_shared boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.workbench_queues.is_shared IS
  'When true, non-owner authenticated collaborators can view/edit this list.';

DROP POLICY IF EXISTS "users manage own queues" ON public.workbench_queues;

CREATE POLICY "workbench list select owner_or_shared"
  ON public.workbench_queues
  FOR SELECT
  USING (
    public.auth_is_non_anonymous_authenticated()
    AND (auth.uid() = user_id OR is_shared = true)
  );

CREATE POLICY "workbench list insert owner_only"
  ON public.workbench_queues
  FOR INSERT
  WITH CHECK (
    public.auth_is_non_anonymous_authenticated()
    AND auth.uid() = user_id
  );

CREATE POLICY "workbench list update owner_or_shared"
  ON public.workbench_queues
  FOR UPDATE
  USING (
    public.auth_is_non_anonymous_authenticated()
    AND (auth.uid() = user_id OR is_shared = true)
  )
  WITH CHECK (
    public.auth_is_non_anonymous_authenticated()
    AND (auth.uid() = user_id OR is_shared = true)
  );

CREATE POLICY "workbench list delete owner_or_shared"
  ON public.workbench_queues
  FOR DELETE
  USING (
    public.auth_is_non_anonymous_authenticated()
    AND (auth.uid() = user_id OR is_shared = true)
  );
