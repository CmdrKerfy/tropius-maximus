-- ============================================================
-- 035: Shared Workbench lists v1 (small-team collaborator mode)
-- ============================================================
-- Keep the existing `workbench_queues` table as the list model.
-- v1 sharing model: any signed-in, non-anonymous teammate can read/write
-- all list rows (create, rename, reorder, delete, edit card_ids).

COMMENT ON TABLE public.workbench_queues IS
  'Shared Workbench lists (v1): collaborators can read/write all rows.';

CREATE INDEX IF NOT EXISTS idx_workbench_queues_updated_at
  ON public.workbench_queues (updated_at DESC, id DESC);

ALTER POLICY "users manage own queues" ON public.workbench_queues
  USING (public.auth_is_non_anonymous_authenticated())
  WITH CHECK (public.auth_is_non_anonymous_authenticated());
