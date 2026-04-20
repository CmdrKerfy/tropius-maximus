-- ============================================================
-- 024: batch_selections — per-user saved card IDs for Batch edit
-- ============================================================
-- Syncs the Explore “batch list” across devices for signed-in users.
-- Anonymous sessions keep localStorage-only (RLS requires non-anonymous JWT).

CREATE TABLE public.batch_selections (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  card_ids   TEXT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_batch_selections_updated ON public.batch_selections (updated_at DESC);

COMMENT ON TABLE public.batch_selections IS
  'Per-user card ID list for /batch (Explore selection). Max length enforced in app.';

ALTER TABLE public.batch_selections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own batch_selections" ON public.batch_selections
  FOR ALL
  USING (auth.uid() = user_id AND public.auth_is_non_anonymous_authenticated())
  WITH CHECK (auth.uid() = user_id AND public.auth_is_non_anonymous_authenticated());
