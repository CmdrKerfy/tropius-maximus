# System performance, ingest, and reliability remediation

**Status:** Active plan; audit complete. Phase 0A completed and owner-approved (committed on `v2/supabase-migration`); Phase 0B not started  
**Created:** 2026-09-25  
**Primary branch:** `v2/supabase-migration`  
**Owner policy:** Do not merge or open a PR to `main` without explicit owner approval. An ingest-only file sync to `main` also requires explicit approval before execution.

## Goal

Restore trustworthy weekly data refreshes, close known correctness and authorization defects, reduce unnecessary frontend/database work, and add enough monitoring and test coverage to prevent recurrence.

This plan is intentionally phased. Implement and review one phase at a time. Do not combine database hardening, ingest redesign, and frontend optimization into one large change.

## Success criteria

- Scheduled Supabase ingest completes reliably and freshness is observable.
- `last_seen_in_api` means the card was actually observed upstream, not merely republished from cached DuckDB.
- Known Workbench, RLS, audit, and partition defects are fixed and covered by tests.
- Explore prefetches become real cache hits and text editing does not create save storms.
- Vercel fails closed on missing production configuration and caches hashed assets immutably.
- Production health checks exercise Supabase and required schema/RPC capabilities.
- Performance decisions are based on authenticated traces and query plans.
- Another agent can implement each phase independently and leave a reviewable handoff.

## Non-goals

- Replatforming away from Supabase, Vercel, or GitHub Actions.
- Merging the v2 frontend into `main`.
- Removing the v1 GitHub Pages deployment while the owner still wants both URLs.
- Upgrading Supabase compute before verified code/query waste is removed and measured.
- Large UI redesigns unrelated to measured performance or correctness.

## Guardrails

1. Preserve all unrelated working-tree changes. Inspect `git status` and relevant diffs before each phase.
2. Work on `v2/supabase-migration` unless the phase explicitly says otherwise.
3. Do not push, deploy, apply production migrations, change secrets, or sync files to `main` without current owner authorization.
4. Create migrations with the Supabase CLI command documented by the installed CLI; do not invent a migration identifier.
5. Keep migrations focused and reversible by forward fix. Do not combine unrelated policy, queue, audit, and performance changes.
6. Test RLS and query performance with a real authenticated JWT context. Superuser-only timings are not representative.
7. Never expose or log `SUPABASE_SERVICE_KEY`.
8. After every phase, update this plan and `docs/plans/agent-handoff-log.md`.
9. After database, ingest, or release-critical work, request the cross-functional review described in `docs/plans/cross-functional-panel-review.md`.

## Verified baseline

### Active operational incident

- Scheduled `Ingest and push to Supabase` failed for 12 consecutive weeks from 2026-07-06 through 2026-09-21.
- The latest scheduled failure used default-branch code and hit Postgres statement timeout `57014` during a fixed 500-row card upsert:
  - https://github.com/CmdrKerfy/tropius-maximus/actions/runs/35612098489
- A 2026-09-26 manual v2 run failed before ingest because `--clear-failed` deletes from `failed_sets` before database initialization:
  - https://github.com/CmdrKerfy/tropius-maximus/actions/runs/36213637704
- Scheduled workflows execute from default branch `main`; its ingest workflow/scripts are older than the v2 working tree.

### Local validation

- `npm run check:quick` passes in the audited working tree.
- Production build baseline:
  - main chunk: approximately 619 KB / 187 KB gzip
  - Explore: approximately 81 KB / 22 KB gzip
  - Supabase adapter: approximately 62 KB / 18 KB gzip
  - Card Detail: approximately 76 KB / 18 KB gzip
- The Supabase build still emits approximately 74 MB of DuckDB WASM, although normal v2 browsers do not request it.
- Production hashed assets currently return `Cache-Control: public, max-age=0, must-revalidate`.
- `npm audit --omit=dev` reports three high-severity advisories involving locked React Router and `ws` versions.

### Local DuckDB snapshot

- `tcg_cards`: 20,237
- `pocket_cards`: 2,349
- `japanese_cards`: 5,935
- `pokemon_metadata`: 1,025
- `japanese_cards_ptcgdb`: absent before normal initialization

### Verified defects

- Explore page prefetch and live query use different React Query keys and query shapes.
- Card Detail free-text fields save on every keystroke.
- Workbench move RPC treats JSONB `card_ids` as `text[]`.
- Current RLS permits broad authenticated writes/deletes on `cards`.
- Edit-history partitions stop at 2027-07-01.
- Maintenance `SECURITY DEFINER` functions are exposed too broadly.
- Pocket/Japanese ingest skips whole sources when local rows already exist.
- Cached rows receive a new `last_seen_in_api` even when not observed upstream.
- Automatic PTCG-db publication can recreate cross-source duplicate risk.
- Vercel can silently build DuckDB mode when Supabase variables are missing, even though required v1 data is excluded.
- Existing Playwright smoke tests exercise local DuckDB only, not hosted Supabase behavior.

## Review and handoff contract

Each implementing agent must:

1. State model acceptance and token feasibility before starting a phase.
2. Mark exactly one phase `In progress`.
3. Record a before measurement or reproducible failing test.
4. Make the smallest implementation that satisfies that phase.
5. Run the phase validation commands.
6. Update this document with:
   - files changed,
   - migrations created/applied and where,
   - test results,
   - measurements,
   - remaining risks.
7. Add a dated entry to `docs/plans/agent-handoff-log.md`.
8. Stop for review before starting the next phase.

The reviewing agent should inspect the diff, rerun automated checks, verify acceptance criteria, and explicitly approve or reject advancement.

---

## Phase 0 — Restore ingest service

**Priority:** Emergency  
**Status:** In progress — 0A completed and approved; 0B not started  
**Dependency:** None

### 0A. Make v2 ingest runnable from an empty checkout

**Status:** Completed 2026-09-25; owner-approved and committed on `v2/supabase-migration` (not pushed)

- [x] Move/perform DuckDB schema initialization before `--clear-failed` accesses `failed_sets`. (`clear_failed_sets()` in commit `74a4875` calls `initialize_database()` first; this slice also makes `get_connection()` create the parent directory.)
- [x] Add a regression test using a temporary nonexistent DuckDB path. (`ClearFailedCliTests` runs `ingest.main()` with `--clear-failed` against a nonexistent path in a nonexistent directory, with `httpx` calls patched to fail if touched.)
- [x] Commit the existing adaptive upsert fix and its focused test together. (Already committed together in `2a209f0`; reviewed and retained unchanged.)
- [x] Confirm `ReturnMethod.minimal` remains enabled. (Asserted by `test_timeout_shrinks_batches_without_duplicates_or_skips`.)
- [x] Add tests for:
  - repeated timeout shrinkage,
  - minimum batch size,
  - a final short batch,
  - no duplicate or skipped rows,
  - non-timeout errors remaining fatal.

**0A results**

- Files changed:
  - `scripts/ingest.py` — `get_connection()` creates the DuckDB parent directory.
  - `scripts/test_ingest.py` — added table-less DuckDB file, older schema missing `failed_sets` (existing rows preserved), and offline CLI `--clear-failed` tests (5 tests total).
  - `package.json` — `check:quick` now also runs `scripts/test_ingest.py` and `scripts/test_push_duckdb_to_supabase.py`.
  - `scripts/test_push_duckdb_to_supabase.py` — added repeated shrinkage with persisted reduced size, shrink to `MIN_BATCH_SIZE` then succeed, timeout at minimum is fatal, final short batch with and without shrink, text-only "statement timeout" retry, non-timeout error after a shrink is fatal, and dry-run makes no requests (10 tests total).
- Before measurement: pre-fix `ingest.py` (`2a209f0`) run with `--clear-failed` on a fresh path raises `CatalogException: Table with name failed_sets does not exist!`; the new CLI test also fails against it.
- Validation:
  - `python scripts/test_ingest.py` — 5 passed.
  - `python scripts/test_push_duckdb_to_supabase.py` — 10 passed.
  - `python scripts/push_duckdb_to_supabase.py --dry-run --duckdb <fresh initialize_database() fixture>` — exit 0, all tables 0 rows.
  - `npm run check:quick` — pass.
  - Local Python is 3.9.7; CI uses 3.12 (not run locally).
- Migrations: none.
- Remaining risks:
  - A 0-byte or corrupt `pokemon.duckdb` (for example a bad cache restore) still fails with DuckDB `IOException`; intentionally not auto-deleted.
  - `--normalize-only` still assumes `tcg_cards` exists (not used by CI).
  - `2a209f0` and `74a4875` exist only on `v2/supabase-migration`; scheduled runs still use `main` until Phase 0B is approved.
  - Adaptive batching detects timeouts by message text (`57014` / `statement timeout`); a changed PostgREST error format would make timeouts fatal instead of retried.

Validation:

- `npm run check:quick`
- Run ingest initialization against a temporary empty path with network-fetch steps mocked or skipped.
- Run `python scripts/push_duckdb_to_supabase.py --dry-run --duckdb <fixture>`.

Acceptance:

- Empty-run initialization no longer raises `CatalogException`.
- Adaptive batching proves that every input row is submitted exactly once after successful retries.

### 0B. Prepare an ingest-only default-branch sync

- [ ] Diff the complete ingest unit between `v2/supabase-migration` and `main`:
  - `.github/workflows/ingest-supabase.yml`
  - `scripts/ingest.py`
  - `scripts/push_duckdb_to_supabase.py`
  - `scripts/jpn_card_key_utils.py`
  - `scripts/requirements-ci.txt`
  - focused ingest tests
  - package/check script only if required to run those tests
- [ ] Ensure the workflow uses `--clear-failed --fail-on-partial`.
- [ ] Add explicit read-only permissions, concurrency, and a realistic timeout.
- [ ] Add failure artifact/summary output without secrets.
- [ ] Ask the owner for explicit authorization before changing `main`.
- [ ] Sync only the approved ingest unit; do not merge the v2 frontend.

Acceptance:

- The default branch contains one internally compatible ingest unit.
- The workflow cannot overlap another ingest publication.

### 0C. Recover production freshness

- [ ] Run `workflow_dispatch` from the corrected default branch.
- [ ] Confirm ingest, publication, materialized-view refresh, and planner-statistics refresh all succeed.
- [ ] Treat materialized-view refresh failure as fatal.
- [ ] Record source row counts, duration, ingest run time, and refresh time in the GitHub step summary.
- [ ] Verify in Supabase:
  - counts by origin,
  - newest trustworthy observation time,
  - no unexpected Japanese cross-source overlap,
  - `explore_filter_options` freshness,
  - representative Explore query succeeds as an authenticated user.

Backout:

- Stop the workflow before publication if validation fails.
- Do not delete cards automatically. Preserve the existing “mark stale, do not delete” policy.

Phase gate:

- [ ] Owner/reviewer confirms a green run and trustworthy freshness evidence.

---

## Phase 1 — Correct ingest semantics and publication safety

**Priority:** High  
**Status:** Not started  
**Dependency:** Phase 0

### 1A. Make refresh semantics truthful

- [ ] Add an `ingest_run_id` and source-level run manifest.
- [ ] Track when each row was actually observed upstream.
- [ ] Update `last_seen_in_api` only for rows fetched in the current successful source run.
- [ ] Replace whole-source “table nonempty” skipping for Pocket/Japanese with upstream set/card reconciliation.
- [ ] Count only non-custom cards when deciding whether an English set is complete.
- [ ] Define periodic full-refresh cadence for corrections to prices, rarity, names, and images.
- [ ] Mark unseen rows stale after a complete source run; do not automatically delete.

### 1B. Remove duplicate/collision hazards

- [ ] Disable automatic PTCG-db ingest/push during ordinary runs.
- [ ] Do not create PTCG-db staging tables unless the explicit source flag is enabled.
- [ ] Use a canonical Japanese key and documented source preference before publishing any future PTCG-db data.
- [ ] Protect manual cards and cross-origin IDs with server-side conflict logic:
  - update only when existing origin matches incoming origin,
  - report collisions,
  - never silently convert manual cards to API cards.

### 1C. Add robust retries and atomic boundaries

- [ ] Reuse an `httpx.Client`.
- [ ] Retry 408, 429, 5xx, connection resets, and gateway timeouts with exponential backoff, jitter, and `Retry-After`.
- [ ] Include swallowed PokeAPI enrichment failures in partial-failure accounting.
- [ ] Fetch into DuckDB staging tables, validate, then swap transactionally.
- [ ] Publish to Postgres staging and finalize one source transactionally.
- [ ] Batch by payload bytes as well as row count.
- [ ] Refresh derived views only after successful finalization.

### 1D. Fix cache and artifact authority

- [ ] Use run/date-specific cache save keys with a stable restore prefix, or consume one canonical validated snapshot.
- [ ] Include dependency/schema/helper hashes in cache identity.
- [ ] Generate a manifest containing source status, counts, checksums, schema version, and run ID.
- [ ] Keep Pages and Supabase consumers on the same validated weekly snapshot where practical.

Validation:

- Fixture-based transform and reconciliation tests.
- Mocked 429/5xx/timeout tests.
- Interrupted-run test proving prior published data remains intact.
- Duplicate/cross-origin collision tests.
- Two consecutive runs proving unchanged data is not falsely re-observed.

Phase gate:

- [ ] Reviewer confirms observation timestamps, stale marking, collision handling, and interrupted-run behavior.

---

## Phase 2 — Database correctness and authorization

**Priority:** High  
**Status:** Not started  
**Dependency:** Phase 0; may proceed in parallel with Phase 1 after recovery

Create separate migrations for each subsection.

### 2A. Repair Workbench move RPC

- [ ] Confirm deployed `card_ids` type and function body.
- [ ] Rewrite JSONB-to-array conversion and JSONB assignment correctly.
- [ ] Lock queue rows in deterministic ID order to reduce deadlock risk.
- [ ] Test owner/shared permissions, duplicates, capacity, missing source cards, and concurrent moves.

### 2B. Restrict card writes

- [ ] Test current policies with real authenticated JWTs.
- [ ] Revoke direct API-card mutations from ordinary authenticated users.
- [ ] Decide with owner whether collaborators may edit all manual cards or only their own.
- [ ] Keep service-role ingest capability.
- [ ] Verify public share remains unaffected.

### 2C. Harden privileged functions

- [ ] Inspect actual function ACLs, including implicit `PUBLIC` execution.
- [ ] Revoke authenticated/anon execution from maintenance refresh and analyze functions.
- [ ] Move privileged helpers out of exposed schema when practical.
- [ ] Retain only intentional anonymous access for public sharing.

### 2D. Make audit writes server-authoritative

- [ ] Derive `updated_by`, `updated_at`, and next version in the RPC.
- [ ] Verify `batch_run_id` belongs to the current user.
- [ ] Reject decreasing or forged versions.
- [ ] Preserve optimistic conflict detection.

### 2E. Automate edit-history partitions

- [ ] Create partitions beyond 2027-Q2.
- [ ] Add a scheduled or deployment-time partition creation mechanism.
- [ ] Add an alert/check when less than two future quarters remain.
- [ ] Add an `edited_at DESC` index only after authenticated EXPLAIN confirms need.

Validation:

- Supabase RLS Tester plus authenticated API tests.
- Rollback-transaction probes for forbidden updates/deletes.
- Workbench move integration test.
- Forged audit/version test.
- Future-dated partition insert test.

Phase gate:

- [ ] Security/data-integrity review approves policies and RPC behavior before production application.

---

## Phase 3 — Remove frontend request and rendering waste

**Priority:** High  
**Status:** Not started  
**Dependency:** Phase 2A for Workbench move QA

### 3A. Fix Explore cache behavior

- [ ] Introduce shared card-list query-key and query-options factories.
- [ ] Make live and prefetched keys identical, including the cursor slot.
- [ ] Make prefetch use the same lookahead semantics.
- [ ] Drive next-page prefetch from `has_more`, not an unreliable planned total.
- [ ] Add a test proving next navigation consumes prefetched cache without another request.

### 3B. Coalesce annotation saves

- [ ] Keep free-text edits local.
- [ ] Save on blur or after a 400–800 ms debounce.
- [ ] Coalesce pending per-card patches.
- [ ] Have the save RPC return authoritative updated annotations to remove the final refetch.
- [ ] Add a test asserting a 20-character edit produces one save.

### 3C. Scale Workbench and Batch

- [ ] Virtualize or paginate queue management.
- [ ] Replace 25-way parallel name/thumbnail requests with a paginated RPC or bounded request pipeline.
- [ ] Key queue hydration by queue ID/version instead of the entire card-ID array.
- [ ] Replace one-request-per-card Batch apply with a transactional chunk/bulk RPC.
- [ ] Preserve per-card errors and retry semantics at chunk boundaries.

### 3D. Correct user-facing behavior

- [ ] Disable or implement unsupported Pokédex, Price, and Featured Region sort choices.
- [ ] Show an explicit three-character search requirement.
- [ ] Prevent Card Detail arrow navigation while focus is in an input/select/textarea/content-editable control.
- [ ] Add proper dialog labelling, focus trap, close-button accessible name, and focus restoration.
- [ ] Eager-load only the first visible card row and measure LCP.

Validation:

- Unit/contract tests for query keys, sorting, and save coalescing.
- Playwright keyboard/editing flows.
- React Profiler at 100, 1,000, and 5,000 queue items.
- HAR request counts for Explore navigation and a 20-character note edit.

Phase gate:

- [ ] Reviewer confirms request-count reductions and no save/navigation regressions.

---

## Phase 4 — Deployment, health, and dependency guardrails

**Priority:** High  
**Status:** Not started  
**Dependency:** Phase 0

### 4A. Fail closed on Vercel configuration

- [ ] Add a prebuild validator for Vercel Preview/Production.
- [ ] Require `VITE_USE_SUPABASE=true`, valid URL/key, and expected email-auth settings.
- [ ] Do not silently fall back to DuckDB when `VERCEL=1`.
- [ ] Add `engines.node` and `packageManager` metadata.

### 4B. Add real health and hosted smoke tests

- [ ] Add `/api/health` with bounded checks for:
  - deployment/build SHA,
  - required environment configuration,
  - Supabase reachability,
  - required migration/schema capability,
  - materialized-view/ingest freshness.
- [ ] Do not expose secrets or sensitive diagnostics.
- [ ] Add hosted preview smoke for auth, Explore, one annotation mutation, Workbench move, and public share.
- [ ] Add an explicit React wildcard/Not Found route.

### 4C. Fix caching and release identity

- [ ] Cache hashed `/assets/*` for one year with `immutable`.
- [ ] Keep HTML revalidating; avoid unnecessary `no-store`.
- [ ] Use Vercel commit/deployment identifiers instead of timestamp fallback for release identity.
- [ ] Record application SHA and compatible migration version.

### 4D. Update dependencies safely

- [ ] Upgrade React Router and the dependency introducing vulnerable `ws`.
- [ ] Upgrade Playwright and browser binaries.
- [ ] Update Vite/build tooling within the current major before considering a major upgrade.
- [ ] Run route/auth/share regressions.
- [ ] Add scheduled dependency and Actions update reporting.

Validation:

- Vercel preview fails when required env is intentionally omitted.
- `/api/health` fails when Supabase is unreachable and passes when healthy.
- Production headers show immutable hashed assets.
- `npm audit --omit=dev` has no unresolved high/critical issue, or accepted exceptions are documented.
- Hosted smoke passes against the exact preview promoted to production.

Phase gate:

- [ ] Deployment/release review approves promotion and rollback evidence.

---

## Phase 5 — Measure and optimize Supabase queries

**Priority:** Medium  
**Status:** Not started  
**Dependency:** Phases 2–4

Do not add indexes or replace hosting based only on static review.

### Measurement matrix

Capture authenticated browser timing, PostgREST timing, and `EXPLAIN (ANALYZE, BUFFERS, SETTINGS)` where safe:

1. Default TCG and All browse, first and deep pages.
2. ASCII `pikachu` and CJK `イーブイ` searches.
3. Canonical set-ID filter, comparing current `set_id OR set_name` with ID-only.
4. Scalar and JSONB annotation filters.
5. Annotation-sourced artist filter.
6. Exact counts for broad and selective filters.
7. `get_form_options_db`.
8. `get_annotation_value_issues`.
9. Recent edit history.

### Candidate optimizations, only if measurements support them

- [ ] Remove `set_name` OR when UI already supplies canonical set IDs.
- [ ] Replace Data Health exact-count fan-out with one grouped summary RPC.
- [ ] Rewrite annotation-issue aggregation to scan/expand annotations once.
- [ ] Materialize or incrementally maintain form options.
- [ ] Add expression index for `extra->>'artist'` or use a server-side join.
- [ ] Move deep non-search pagination to keyset pagination with matching composite indexes.
- [ ] Gate or cache exact counts according to measured product value.
- [ ] Remove unused CJK RPC/index only after usage and CJK plan evidence.
- [ ] Remove duplicate/unused indexes only after `pg_stat_user_indexes` observation.

Phase gate:

- [ ] Every performance migration includes before/after authenticated plans and rollback criteria.

---

## Phase 6 — Build boundary and observability

**Priority:** Medium  
**Status:** Not started  
**Dependency:** Phase 4

- [ ] Add a Supabase-only build target that excludes DuckDB modules, workers, WASM, and v1 data.
- [ ] Preserve and test the GitHub Pages DuckDB build.
- [ ] Add bundle budgets for initial gzip, route chunks, and v2 deployment artifact size.
- [ ] Add RUM for LCP, INP, and CLS by route/device.
- [ ] Add structured serverless logs with request ID, duration, upstream status, and build SHA.
- [ ] Add alerts for:
  - one ingest failure,
  - freshness older than seven days,
  - health endpoint failure,
  - repeated share-function errors.
- [ ] Add an RPC timeout, image-host allowlist, and abuse controls to public share rendering after measuring traffic.

Acceptance:

- V2 deployment no longer contains DuckDB runtime assets.
- V1 remains functional.
- Operators can identify the deployed SHA, data freshness, and failing subsystem without reading raw ad hoc logs.

---

## Final release review

- [ ] Run `npm run check`.
- [ ] Run the full hosted Vercel smoke checklist.
- [ ] Run Supabase security/performance advisors.
- [ ] Confirm latest migration and app SHA compatibility.
- [ ] Confirm ingest freshness and no Japanese duplicate recurrence.
- [ ] Complete cross-functional panel review.
- [ ] Obtain explicit owner go/no-go for any production promotion.
- [ ] Keep `main` merge/cutover out of scope unless the owner explicitly requests it.

## Exact next action

Phase 0A is committed and approved. When the owner authorizes Phase 0B, begin it by diffing the ingest unit between `v2/supabase-migration` and `main` (`git diff main v2/supabase-migration -- .github/workflows/ingest-supabase.yml scripts/ingest.py scripts/push_duckdb_to_supabase.py scripts/jpn_card_key_utils.py scripts/requirements-ci.txt scripts/test_ingest.py scripts/test_push_duckdb_to_supabase.py`). Do not change `main` without explicit owner authorization.
