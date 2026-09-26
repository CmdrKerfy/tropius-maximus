-- ============================================================
-- Phase 1A: content fingerprint for API-published cards
-- ============================================================
-- Every push used to rewrite every API row (~36k) even when nothing upstream
-- changed. The rewritten pages made the next checkpoint and first scans
-- I/O-bound, which is what timed out refresh_explore_filter_options in run
-- 36273193023 (see the remediation plan, 0B.3 "Refresh timeout headroom").
--
-- scripts/push_duckdb_to_supabase.py stores a SHA-256 of each published
-- payload here and skips rows whose fingerprint is unchanged. Only the push
-- writes this column; NULL (manual cards, rows not yet re-published) means
-- "publish on the next run".
--
-- Nullable with no default: a catalog-only change, no table rewrite. It still
-- takes a brief ACCESS EXCLUSIVE lock on cards, so apply it when no ingest is
-- publishing. Existing views (explore_filter_options) are unaffected because
-- views store their expanded column lists.

ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS api_hash text;

COMMENT ON COLUMN public.cards.api_hash IS
  'SHA-256 of the last API payload published by push_duckdb_to_supabase.py (excluding last_seen_in_api); NULL = publish on next run.';

NOTIFY pgrst, 'reload schema';
