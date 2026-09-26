-- ============================================================
-- Phase 0B.2 (1/3): statement/lock timeout budget for service_role
-- ============================================================
-- Root cause of the post-push 57014 failures (verified 2026-09-26 via
-- pg_roles): service_role has no rolconfig, so PostgREST requests made with
-- the service key inherit the authenticator role's statement_timeout=8s and
-- lock_timeout=8s. refresh_explore_filter_options() takes ~12 s, so it
-- fails deterministically over PostgREST; retries alone cannot fix that.
--
-- Supabase docs (Database > Postgres > Timeouts, "Role level"):
--   https://supabase.com/docs/guides/database/postgres/timeouts#role-level
--   "service_role: none (defaults to the authenticator role's 8s timeout if
--   unset)", and Client API timeout changes need
--   NOTIFY pgrst, 'reload config'. The same page notes Client API queries
--   have a max-configurable timeout of 60 seconds, so 60s is used rather
--   than a larger value the HTTP layer would cut off anyway.
-- PostgREST docs (References > Transactions, "Impersonated Role Settings"):
--   https://docs.postgrest.org/en/stable/references/transactions.html
--   "PostgREST applies the impersonated roles settings as transaction-scoped
--   settings", so role-level settings on service_role apply to its requests.
--
-- A function-level SET statement_timeout clause is deliberately NOT used:
-- the statement timer for the outer RPC call is already running when the
-- function's SET takes effect.
--
-- Scope: only service_role (ingest/maintenance, server-side key). anon and
-- authenticated keep their existing 3s / 8s limits.
--
-- Verify after applying (read-only):
--   SELECT rolname, rolconfig FROM pg_roles WHERE rolname = 'service_role';

ALTER ROLE service_role SET statement_timeout = '60s';
ALTER ROLE service_role SET lock_timeout = '60s';

NOTIFY pgrst, 'reload config';
