# System performance, ingest, and reliability remediation

**Status:** Active plan; manual v2 ingest recovery completed, but default-branch scheduling is not yet trustworthy. Phase 0B.1 accepted; 0B.2 committed and pushed (`6f36a0d`, badge fix `3bde76b`) and its three migrations **applied to production 2026-09-26**; confirmation via a real service-key ingest run is pending. 0B.4 (Workbench move hotfix) committed (`3907b09`) and its migration **applied to production 2026-09-26**; **accepted** after the owner's post-apply check and signed-in move QA; pushed. 0B.3 v2-side hardening committed (`954a5bd`) and **approved in review 2026-09-26**; `main` sync not done. Phase 0C has not started.
**Created:** 2026-09-25  
**Last reconciled:** 2026-09-26 against pushed `v2/supabase-migration` commit `bff91cc`; plan review corrections applied 2026-09-26 (see "Plan review 2026-09-26")
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

### Operational status after manual recovery

- Scheduled `Ingest and push to Supabase` failed for 12 consecutive weeks from 2026-07-06 through 2026-09-21.
- The latest scheduled failure used default-branch code and hit Postgres statement timeout `57014` during a fixed 500-row card upsert:
  - https://github.com/CmdrKerfy/tropius-maximus/actions/runs/35612098489
- A 2026-09-26 manual v2 run failed before ingest because `--clear-failed` deletes from `failed_sets` before database initialization:
  - https://github.com/CmdrKerfy/tropius-maximus/actions/runs/36213637704
- Recovery commits through `bff91cc` are pushed on `v2/supabase-migration`; `main` still has the older scheduled ingest unit.
- A manual run from commit `4493d76` completed ingest and publication:
  - https://github.com/CmdrKerfy/tropius-maximus/actions/runs/36228427545
  - Published 176 TCG sets, 15 Pocket sets, 184 Japanese sets, 1,025 Pokémon metadata rows, 20,670 pokemontcg.io cards, 2,480 Pocket cards, 12,781 TCGdex Japanese rows, and 0 PTCG-db rows.
  - The workflow stayed green even though both `refresh_explore_filter_options` and `analyze_cards_and_annotations` failed with `57014`; the materialized view was refreshed manually afterward in about 12 seconds.
- Current production filter-option completeness was manually verified after that refresh: TCG rarities 51/51, TCG artists 400/400, Pocket rarities 11/11, Pocket card types 2/2, and regions/generations/colors/evolution lines/weather/environment matched their source tables.
- Scheduled workflows execute from default branch `main`; its ingest workflow/scripts are older than the v2 working tree.

### Local validation

- `npm run check:quick` passes locally in the audited working tree.
- Commit `bff91cc` added Python setup/dependency installation to `Site checks (quick)`; GitHub run `36230895162` passed.
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

### Verified Pocket source coverage gap

- The live TCGdex Pocket series endpoint currently exposes 15 sets and stops at `B2a`: https://api.tcgdex.net/v2/en/series/tcgp
- `flibustier/pokemon-tcg-pocket-database` version 2.10.0 is active and MIT-licensed for its repository contents. Its current `sets.json` lists 23 sets, including eight absent from TCGdex: `A4b`, `B2b`, `B3`, `B3a`, `B3b`, `B4`, `B4a`, and `PROMO-B`.
- Source repository: https://github.com/flibustier/pokemon-tcg-pocket-database
- The alternative dataset supplies image filenames and newer card metadata, but source/image URL reliability, canonical ID parity, field quality, and artwork redistribution rights still require a fixture-based comparison. The repository's MIT license alone does not prove that Pokémon card artwork may be mirrored to a new public host.
- Missing/newer Pocket sets and broken images are source-coverage/data-quality defects, not evidence that the new typed `set_id IN (...)` query path failed. Phase 0B.1 QA must record query behavior separately from image/catalog completeness.

### Verified defects

- Explore page prefetch and live query use different React Query keys and query shapes.
- Card Detail free-text fields save on every keystroke.
- Workbench move RPC treats JSONB `card_ids` as `text[]`.
- Current RLS permits broad authenticated writes/deletes on `cards`.
- Edit-history partitions stop at 2027-07-01.
- Maintenance `SECURITY DEFINER` functions are exposed too broadly.
- Pocket/Japanese ingest was changed in `4493d76` to reconcile missing card IDs incrementally; correction/full-refresh semantics and truthful observation timestamps remain unresolved.
- Cached rows receive a new `last_seen_in_api` even when not observed upstream.
- Automatic PTCG-db publication can recreate cross-source duplicate risk.
- Post-push materialized-view refresh failure is swallowed, allowing a stale filter view to produce a green ingest run.
- Planner `ANALYZE` failure is swallowed without retry or a prominent summary; it should remain nonfatal but observable.
- **Root cause of the `57014` maintenance failures (verified 2026-09-26 via `pg_roles`):** `service_role` has no `rolconfig`, so PostgREST RPC calls inherit `authenticator`'s `statement_timeout=8s` and `lock_timeout=8s`. `refresh_explore_filter_options` takes ~12 s when run manually, so it fails deterministically over PostgREST; retries alone cannot fix it. `ANALYZE` and the original 500-row upsert timeouts very likely share this cause.
- `refresh_explore_filter_options()` uses a non-concurrent `REFRESH MATERIALIZED VIEW` (ACCESS EXCLUSIVE lock blocks Explore reads for the refresh duration) even though the required unique index `idx_explore_filter_options_source` exists. It is also granted to `authenticated` (see 2C).
- **Workbench move is broken in production (verified 2026-09-26):** live `workbench_queues.card_ids` is `jsonb`; deployed `move_workbench_cards(bigint, bigint, text[], integer)` contains no JSONB handling and does `COALESCE(v_source.card_ids, '{}'::text[])`, which should raise a type error on every call. Called from `src/data/supabase/appAdapter.js` (`move_workbench_cards`). Pulled forward to 0B.4.
- Explore Specialty options are hardcoded empty even though live card subtypes contain `ACE SPEC`, `Pokémon Tool`, `Pokémon Tool F`, and `Technical Machine`. Both the materialized view (054/055) and the split RPCs (053) return empty/absent `specialties`, `actions`, and `poses`, so neither existing path can supply them.
- Explore Action and Pose options merge static lists only, omitting database-only annotation values such as `attacking` and `Arms Overhead`.
- Client-paged filter fallbacks silently stop after 5,000 rows (`MAX_FALLBACK_SCAN_ROWS` in `distinctColumn`, `distinctAnnotationColumn`, and `mergeAnnotationUsageIntoOptions`) although the live catalog is approximately 67,663 cards; removing the cap by scanning the full catalog client-side is not an acceptable long-term fix.
- Commit `bff91cc` replaced canonical `set_id OR set_name` filtering with typed `set_id IN (...)` for both grid and count paths; authenticated production QA passed (0B.1 accepted 2026-09-26).
- Vercel can silently build DuckDB mode when Supabase variables are missing, even though required v1 data is excluded.
- Existing Playwright smoke tests exercise local DuckDB only, not hosted Supabase behavior.

## Plan review 2026-09-26

An independent review (Claude Opus 5.5) checked this plan against the code and the live Supabase database (read-only queries only). Verdict: the structure, guardrails, and most defect claims are accurate. The following corrections were applied to this document:

1. **0B.2 refresh fix changed from "retry" to "fix the timeout budget first."** The `57014` failures are deterministic (8 s inherited limit versus a ~12 s refresh), so bounded retries alone would make every weekly run red without refreshing anything. Retries remain for transient failures only.
2. **Workbench move RPC pulled forward from 2A to new slice 0B.4.** It is a user-facing production bug independent of ingest work.
3. **0B.2 now names where Specialty/Action/Pose values come from.** Neither the materialized view nor the split RPCs supply them; making the split RPCs the fallback does not fix Specialty.
4. **Stale statements fixed:** 0B.1 acceptance is reflected everywhere; Phase 5 `set_name` OR removal is marked done by `bff91cc`.
5. **Scope note:** for a 1–3 user app, Phases 5–6 and most of 1C/1E are optional after Phases 0–2 land. Do not start them without owner confirmation that they are still wanted.

Verified accurate (no change needed): swallowed refresh/`ANALYZE` failures; three 5,000-row caps; broad authenticated insert/update/delete policies on `cards` (007/019); edit-history partitions ending 2027-07-01; remote `main` ingest unit ~1,200 lines behind v2; `main`'s `deploy-pages.yml` also runs `ingest.py --clear-failed` (so 0B.3's v1-consumer protection is needed; `--skip-japanese` exists); PTCG-db ingest only runs via explicit `--japanese-ptcgdb*` flags.

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
**Status:** In progress — 0A and manual recovery work are pushed on v2; 0B stabilization/review is in progress; `main` remains unchanged
**Dependency:** None

### 0A. Make v2 ingest runnable from an empty checkout

**Status:** Completed 2026-09-25; owner-approved in commit `6869e2d`, now pushed as an ancestor of `597532d`

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

### Recovery work completed after 0A

These commits were implemented and pushed before this plan was reconciled. They are retained but still require review against the updated phase gates:

- `79267ef` — resumable ingest across API failures:
  - restores the latest DuckDB progress cache,
  - retries incomplete ingest once in the same workflow,
  - saves progress even when ingest remains incomplete,
  - pushes to Supabase only after complete ingest,
  - performs a bounded retry pass for transient TCG set failures.
- `4493d76` — incremental TCGdex and post-push RPC compatibility:
  - Pocket/Japanese ingest fetches missing card IDs per set instead of skipping a nonempty source wholesale,
  - zero-argument PostgREST RPCs now pass `{}`,
  - tests cover incremental TCGdex ingestion and maintenance RPC invocation.
- `597532d` — live Explore set metadata overlay:
  - reads the small `sets` table directly so new sets remain selectable when the aggregate materialized view is stale,
  - adds source grouping/deduplication tests.
- `bff91cc` — indexed set filtering and restored quick checks:
  - applies typed `set_id IN (...)` to normal and count-only Explore queries,
  - adds focused normalization/typed-filter tests,
  - installs Python 3.12 and `scripts/requirements-ci.txt` in Site Checks,
  - passed GitHub Site Checks run `36230895162`.

These changes do **not** complete Phase 0: the default branch is still old, refresh failures still stay green, `last_seen_in_api` is still not trustworthy for cached rows, and the set-ID query still needs authenticated production QA.

### 0B. Stabilize v2 and prepare an ingest-only default-branch sync

**Status:** In progress. 0B.1 (set-ID query + Site Checks, `bff91cc`) is accepted after signed-in production QA. 0B.2 is committed/pushed and its migrations are applied (awaiting confirmation from the next ingest run's logs). 0B.4 is accepted (2026-09-26). 0B.3 v2-side work is approved in review (`954a5bd`); the `main` sync and a real Actions run are pending.

Implement and review the following as separate, focused commits. Do not combine ingest maintenance, frontend filters, and default-branch synchronization into one change.

#### 0B.1 Restore a trustworthy test gate and indexed set queries

**Status:** Accepted 2026-09-26. Signed-in production QA confirmed `me55` (30th Celebration), `B2a` (Paldean Wonders), and the combined Source=All selection load cards/counts without query errors. Most `B2a` images remain missing; that is tracked separately in Phase 1E.

- [x] Fix `.github/workflows/site-checks.yml` to set up Python 3.12 and install `scripts/requirements-ci.txt` before `npm run check:quick`. (`bff91cc`; GitHub run `36230895162` passed.)
- [x] Replace canonical Explore set filters with `set_id IN (...)` in both the normal grid and count-only query. (`bff91cc`)
- [x] Preserve one TCG ID, one case-sensitive Pocket ID, multiple IDs, trimming/deduplication, and values handled safely by Supabase's typed `.in()` API. (`bff91cc`)
- [x] Test the ID-only query as an authenticated user before considering another index; no new index was required for this gate.
- [x] Review and commit the scoped changes in:
  - `.github/workflows/site-checks.yml`
  - `src/data/supabase/appAdapter.js`
  - `src/lib/exploreSetFilter.js`
  - `src/lib/__tests__/mergeExploreFilterOptions.test.mjs`

#### 0B.2 Make post-push maintenance and filter options trustworthy

**Status:** Implemented 2026-09-26 (Claude Opus 5.5). Committed as `6f36a0d` and pushed to `v2/supabase-migration` with owner approval (Pocket badge fix separately as `3bde76b`). All three migrations were **applied to production on 2026-09-26 with owner approval**, run as SQL in order (the same way as 030–057; they are not recorded in the migration history table). No ingest has been dispatched.

Do the timeout fix first; retries alone cannot succeed against a deterministic 8 s limit (see Verified defects).

- [x] **Fix the maintenance timeout budget (migration; owner approval required before applying to production).** Written as `20260926092111_service_role_maintenance_timeout.sql`: `ALTER ROLE service_role SET statement_timeout = '60s'` + `lock_timeout = '60s'` + `NOTIFY pgrst, 'reload config'`. **Deviation flagged:** the plan/prompt preferred `120s`; the Supabase Timeouts doc says Client API queries have a max-configurable timeout of 60 s, so 60 s was used (still ~3× the expected refresh). **Owner deferred to the recommendation (2026-09-26): keep 60 s.** Docs confirmed (citations below). No function-level `SET statement_timeout` is used. Not applied.
- [x] After the change, verify that the refresh and `ANALYZE` complete, with durations. Done 2026-09-26 as `service_role` over SQL with the 60 s limit: **refresh (CONCURRENTLY) 7.5 s, ANALYZE 12.5 s** (ANALYZE would have failed under the old 8 s). The service key is not available to agents, so the PostgREST path itself is confirmed only by the next ingest run's log lines (`refreshed in …s`, `analyze … refreshed in …s`).
- [x] Switch the refresh to `REFRESH MATERIALIZED VIEW CONCURRENTLY` (the unique index already exists) so Explore reads are not blocked during the refresh. Written as `20260926092113_refresh_explore_filter_options_concurrently.sql`. Re-measure after applying (not possible read-only).
- [x] Retry `refresh_explore_filter_options` with bounded backoff for transient failures; after exhaustion, raise so the ingest workflow fails.
- [x] Retry `analyze_cards_and_annotations` with bounded backoff, but keep final failure nonfatal and prominently annotate it in logs/summary.
- [x] Add tests for successful retry, exhausted fatal refresh, and exhausted nonfatal `ANALYZE`.
- [x] Populate Specialty options from authoritative live card subtype values, and merge database Action/Pose values with the curated static lists. **Source chosen: the materialized view** (migration `20260926092115_explore_filter_options_annotation_facets.sql`); justification under 0B.2 results.
- [x] Make the server-side split RPC path an automatic fallback when the materialized view is unavailable or invalid. Each split RPC measured as `authenticated` (timings below).
- [x] Remove silent 5,000-row truncation. Explore has no client-paged path any more; the remaining capped helpers (form-options fallback) now throw instead of returning a partial list. If every authoritative Explore path fails, the UI shows an explicit error with Retry.
- [x] Keep the live `sets` overlay from `597532d` (now applied on both the view and the split-RPC paths).
- [x] Do not solve fallback completeness by routinely downloading all approximately 67,663 cards to the browser.

**0B.2 results**

- **Expected red ingest (historical; migration 1 is now applied):** until `20260926092111_service_role_maintenance_timeout.sql` was applied, the next ingest that runs this v2 push script **will fail at the `refresh_explore_filter_options` step** (three attempts, each `57014` at the inherited 8 s limit, then `::error` and exit 1). That is the intended behavior: the old script swallowed this failure and stayed green with a stale view. (Scheduled runs still execute `main`'s older script until 0B.3, so they keep the old swallow-and-stay-green behavior.)
- **Migration apply order** (applied 2026-09-26 in this order; post-apply checks: `service_role` rolconfig = 60 s/60 s; function SECURITY DEFINER + `search_path=""` + CONCURRENTLY, ACL unchanged; view has 4 rows, `facets_version` 1, the four specialties, 42 actions, 32 poses, TCG rarities 51 / artists 400, ACL `authenticated=r`, `service_role=r`; authenticated read OK):
  1. `supabase/migrations/20260926092111_service_role_maintenance_timeout.sql` — then read-only check `SELECT rolname, rolconfig FROM pg_roles WHERE rolname = 'service_role';`
  2. `supabase/migrations/20260926092113_refresh_explore_filter_options_concurrently.sql`
  3. `supabase/migrations/20260926092115_explore_filter_options_annotation_facets.sql` — drops/recreates the view WITH DATA (~17 s; Explore filter-option reads wait on the lock and the new client falls back to split RPCs if they time out). Afterwards `SELECT options->'specialties', options->'facets_version' FROM explore_filter_options WHERE source = 'tcg';`
  4. Then the timed service-key RPC verification (refresh + `ANALYZE`), recording durations.
- **Migration naming:** existing files use `NNN_` prefixes (`001`–`057`); the installed CLI (`supabase` v2.90.0, `supabase migration new`) generates `YYYYMMDDHHMMSS_` timestamps. Both sort correctly after `057_…`. Checked 2026-09-26 (read-only `list_migrations`): the remote history table records only `001`–`029`; `030`–`057` were applied manually (SQL editor) and are untracked. **Do not run `supabase db push`** — it would try to re-apply 030–057. Apply the 0B.2 files the same way as 030–057 (run each file's SQL once, in order) until migration history is reconciled.
- **Docs citations (timeout budget):**
  - Supabase, Database → Postgres → Timeouts, "Role level": https://supabase.com/docs/guides/database/postgres/timeouts#role-level — "`service_role`: none (defaults to the `authenticator` role's 8s timeout if unset)"; Client API changes need `NOTIFY pgrst, 'reload config'`; Client API queries have a max-configurable timeout of 60 s.
  - PostgREST, References → Transactions, "Impersonated Role Settings": https://docs.postgrest.org/en/stable/references/transactions.html — "PostgREST applies the impersonated roles settings as transaction-scoped settings."
  - Verified read-only: `postgres` holds `ADMIN` on `service_role` (PG 17.6), so the migration role may `ALTER ROLE service_role SET …`.
- **Measurements (read-only, 2026-09-26, live project):**
  - Split RPCs as `authenticated` (`SET LOCAL ROLE authenticated`, `request.jwt.claims` non-anonymous, `SET LOCAL statement_timeout = '8s'`, rolled back; `EXPLAIN ANALYZE` execution time): TCG 704 ms, Pocket 609 ms, Custom 24 ms, Japanese 1,662 ms. Each is well under 8 s individually; one earlier probe running all four **inside a single statement** exceeded 8 s, which does not apply to the client (four separate parallel requests).
  - Candidate standalone Specialty/Action/Pose RPC as `authenticated`: **6,329 ms cold / 2,505 ms warm** (full seq scan of the 130 MB `cards` heap with per-row RLS checks). Annotation parts are negligible (1,126 rows).
  - Same facet CTEs as the view owner (refresh context, no RLS): **~5.1 s** added to the refresh. Estimated refresh after migration 3: ~12 s (manual baseline) + ~5 s ≈ 17 s plus a trivial CONCURRENTLY diff (4 rows) — well inside 60 s.
  - Live values: specialties `ACE SPEC`, `Pokémon Tool`, `Pokémon Tool F`, `Technical Machine`; 42 distinct actions (15 DB-only, e.g. `attacking`) and 32 distinct poses (20 DB-only, e.g. `Arms Overhead`); no case conflicts with the static lists today.
- **Source decision (Specialty/Action/Pose → materialized view):** a standalone authenticated RPC was measured at 6.3 s cold against the 8 s limit — not "well under". Inside the view refresh it runs once per ingest as the owner under the service_role budget, and Explore keeps its single <50 ms read. Cost: +~5 s refresh; Action/Pose values that users add between ingests appear after the next refresh (same staleness as weathers/environments); curated static lists are always merged so no curated value is lost. The view's `tcg` row carries a `facets_version: 1` marker so the client can tell populated facets from the pre-0B.2 view's empty placeholders.
- **Frontend behavior** (`src/lib/exploreFilterOptionsSource.js`, `fetchExploreFilterOptions` in `src/data/supabase/appAdapter.js`):
  1. Materialized view (validated: non-empty, all four source rows, list-or-null values).
  2. Split RPCs automatically if the view fails/is empty/malformed (no env flag; `VITE_USE_FILTER_OPTIONS_RPC` is no longer read). All four must succeed; a missing function counts as failure.
  3. Otherwise `ExploreFilterOptionsError`; Explore shows a red alert with Retry.
  - Specialty/Action/Pose come only from the view's facets. If unavailable (view missing facets because migration 3 is not applied yet, or the split-RPC path is in use), only those three degrade to curated static lists (`ACE SPEC`/`Pokémon Tool`/`Pokémon Tool F`/`Technical Machine` for Specialty) and Explore shows an amber notice. All other filters keep working.
  - Case-insensitive dedupe; the stored database spelling wins over the static spelling because the Action/Pose filters use case-sensitive JSONB containment.
  - **Deploy safety:** pushing this frontend before any migration is safe — the current view lacks `facets_version`, so the only visible change is the amber notice until migration 3 is applied.
- **Grants:** migration 1 changes only `service_role` settings. Migration 2 is `CREATE OR REPLACE` (existing ACL kept, not widened; revoking anon/authenticated/PUBLIC execute remains Phase 2C) with `SECURITY DEFINER` + `SET search_path = ''` + schema-qualified target. Migration 3 recreates the view with `SELECT` for `authenticated` and `service_role` only (the previous view had Supabase default privileges, including full privileges for `anon`) — a narrowing.
- **Retry policy** (`scripts/push_duckdb_to_supabase.py`): 3 attempts, backoff 5 s then 15 s. Retryable: `57014`, `55P03` (lock timeout), SQLSTATE `08*`/`57P0*`, PostgREST `PGRST000`–`PGRST003`, HTTP 5xx surfaced as numeric codes, `httpx.TransportError`, `ConnectionError`/`TimeoutError`, and statement/lock-timeout/connection-reset messages. Everything else fails immediately. Refresh exhaustion prints a `::error` annotation with JSON `{step, status, attempts, final_reason}` and raises (exit 1). ANALYZE exhaustion prints a `::warning` annotation with the same JSON and continues. Reasons contain exception type, code, and a 200-character message only (the service key travels only in headers).
- **Files changed:**
  - `supabase/migrations/20260926092111_service_role_maintenance_timeout.sql` (new)
  - `supabase/migrations/20260926092113_refresh_explore_filter_options_concurrently.sql` (new)
  - `supabase/migrations/20260926092115_explore_filter_options_annotation_facets.sql` (new; 055's view body plus three CTEs — diffed against 055)
  - `scripts/push_duckdb_to_supabase.py`, `scripts/test_push_duckdb_to_supabase.py`
  - `src/lib/exploreFilterOptionsSource.js` (new), `src/lib/__tests__/exploreFilterOptionsSource.test.mjs` (new)
  - `src/data/supabase/appAdapter.js`, `src/pages/ExplorePage.jsx`, `package.json` (test script), `.env.example` (flag comment)
- **Validation:**
  - `python scripts/test_push_duckdb_to_supabase.py` — 19 passed (9 new maintenance tests: immediate success, transient-then-success, gateway 5xx retried, exhausted refresh fatal, non-transient refresh immediately fatal, exhausted ANALYZE nonfatal and reported, `{}` params on retries, no secret in reasons).
  - `node --test src/lib/__tests__/exploreFilterOptionsSource.test.mjs` — 16 passed.
  - `npm run check:quick` — exit 0.
  - Migrations: parse-only check with `pglast` (libpg_query) passed for all three; the full new view query was `PREPARE`d (parse + analyze, not executed) against the live schema successfully; function body parsed. Nothing applied.
  - `git diff --check` — only two pre-existing trailing-space markdown hard breaks in this plan's earlier uncommitted edits (lines under Phases 5/6); none in 0B.2 files.
- **Remaining risks:**
  - Durations after the migrations are estimates until the timed RPC verification runs.
  - The 60 s value may need raising if the refresh grows (the HTTP layer caps Client API requests at 60 s regardless).
  - `refresh_explore_filter_options` is still executable by `anon`/`authenticated`/`PUBLIC` (Phase 2C).
  - Stale references to `VITE_USE_FILTER_OPTIONS_RPC` / the client-paged fallback remain in `CLAUDE.md`, `docs/plans/p1-cutover-and-operations.md`, `docs/plans/e2e-vercel-smoke-checklist.md`, `docs/plans/explore-supabase-performance.md`, and `docs/plans/supabase-perf-hosting-alternatives-notes.md`; left untouched to keep this diff to 0B.2 and to preserve their pending uncommitted edits.
  - If `get_form_options_db` fails, the form-options fallback now errors (Workbench/Card Detail suggestions fall back to empty) instead of showing a silently truncated list.
  - Legacy comma-joined values (for example `attacking the cameraman, Running`) appear as single options because they are stored that way; cleanup is a data task, not 0B.2.
- **Owner QA follow-ups (2026-09-26, production `bff91cc`, pre-dating 0B.2):**
  - **Fixed in the working tree (separate from 0B.2; commit separately):** Japanese cards showed a "Pocket" badge because the grid treated every `tcgdex`/`ptcgdb` card as Pocket. New `src/lib/cardSource.js` `isPocketOrigin()` (tcgdex and not Japanese, matching the Source=Pocket query) is used by `CardGrid.jsx` and the adapter's `is_pocket`; test added to `mergeExploreFilterOptions.test.mjs`. Card-detail data shaping (`fetchCard`) and prefetch keys were intentionally left unchanged. Separately, cards with no image fall back to the Pocket card-back artwork, which makes missing Japanese images look like Pocket cards (missing images are Phase 1E).
  - **Not reproduced:** mobile Explore sometimes loads zoomed out with a blank strip on the right (Brave on iOS). No horizontal overflow at 390 px in DuckDB mode (default and Name sort); the signed-in Supabase view could not be rendered locally without a session. Needs reproduction details before a fix; a global `overflow-x: clip` guard is an option but would mask rather than explain the cause. **Shelved by owner 2026-09-26** — revisit when reproduction details are available.

#### 0B.3 Harden and recalculate the default-branch sync

**Status:** v2-side hardening implemented 2026-09-26 (Claude Opus 5.5), committed `954a5bd`; **approved in review 2026-09-26** (see "Review" below). The `main` sync has **not** happened and needs explicit owner approval.

- [x] Re-diff the complete ingest unit from current v2 HEAD against the **actual remote** `main` (local `main` may be stale):
  - `.github/workflows/ingest-supabase.yml`
  - `scripts/ingest.py`
  - `scripts/push_duckdb_to_supabase.py`
  - `scripts/jpn_card_key_utils.py`
  - `scripts/requirements-ci.txt`
  - focused ingest tests
  - package/check script only if required to run those tests
- [x] Preserve the resumable restore/save behavior from `79267ef` and incremental TCGdex behavior from `4493d76`. (Cache restore/save steps and ingest code paths unchanged.)
- [x] Ensure the workflow uses `--clear-failed --fail-on-partial` and never publishes after an incomplete ingest. (Push gated on `steps.ingest.outcome == 'success'`; the skip is now also written to the step summary.)
- [x] Add explicit read-only permissions, concurrency, and a realistic timeout.
- [x] Add failure artifact/summary output without secrets.
- [x] Include source row counts, ingest duration, publication duration, materialized-view refresh result/duration, and `ANALYZE` result/duration in the step summary.
- [x] Disable ordinary automatic PTCG-db publication or require an explicit opt-in so cached staging rows cannot recreate duplicates.
- [x] Protect the v1 Pages consumer from unintended Japanese ingest work (for example, pass `--skip-japanese` if the shared script's default includes Japanese while its exporter does not).
- [x] Do not sync `package.json`/`package-lock.json` merely to run Python tests; invoke focused Python tests directly in the ingest workflow.
- [ ] Ask the owner for explicit authorization before changing `main`.
- [ ] Sync only the approved ingest unit; do not merge the v2 frontend.

**Re-diff result (2026-09-26, v2 `ff5a374` vs remote `main` `2e5543a`; local `main` `d189743` is stale):**

| File | `main` | v2 | Notes |
|---|---|---|---|
| `.github/workflows/ingest-supabase.yml` | 52 lines | 91 (before 0B.3) | `main` has no tests, resume, `--clear-failed`/`--fail-on-partial`, or publish gate |
| `scripts/ingest.py` | 886 | 1,699 | Additive DuckDB tables only (Japanese, PTCG-db); tables read by v1 `export_parquet.py` are unchanged |
| `scripts/push_duckdb_to_supabase.py` | 285 | 633 | Includes 0B.2 maintenance retry/timing |
| `scripts/jpn_card_key_utils.py` | absent | 37 | **Required** — v2 `ingest.py` imports it |
| `scripts/requirements-ci.txt` | identical | identical | No sync needed |
| `scripts/test_ingest.py`, `test_push_duckdb_to_supabase.py`, `test_jpn_card_key.py` | absent | present | Python-only; need just `requirements-ci.txt` |
| `.github/workflows/deploy-pages.yml` | differs by one flag | | v2 had added `--fail-on-partial` to the v1 Pages ingest |

Findings:

- `main`'s 2026-09-21 scheduled ingest step took 1 s (effectively a no-op against its old cache) before the push failed with `57014`.
- `main`'s `deploy-pages.yml` runs the same `scripts/ingest.py`, so syncing the script changes the v1 consumer. v2 ingests Japanese data by default; v1's exporter never reads it.
- v2 `initialize_database()` always creates `japanese_cards_ptcgdb`, and the push script published that table whenever it existed — only an empty table prevented PTCG-db republication.
- DuckDB caches are branch-scoped: `main` cannot restore the v2 `duckdb-Linux-*` caches, so the first run from `main` starts without progress. Evidence: v2 run `36215951396` (little cached progress) spent 3 h 25 min in ingest; run `36228427545` (warm) spent 11 min in ingest and 4 min 45 s in push.

**Implementation (v2 only):**

- `.github/workflows/ingest-supabase.yml`: `permissions: contents: read`; `concurrency` group `ingest-supabase` without cancel-in-progress; job `timeout-minutes: 350`, ingest step 300 (step-level so progress is still saved), push step 45; explicit `bash` shell (pipefail) with `tee` into `ingest-logs/`; runs `test_jpn_card_key.py`; the incomplete-ingest step writes "Publication skipped" to the step summary; on failure, secret values are scrubbed from the logs and uploaded as artifact `ingest-logs-<run>-<attempt>` (14-day retention, `actions/upload-artifact@v7`); `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24`.
- `scripts/ingest.py`: `source_row_counts`, `format_ingest_summary`, `write_step_summary`; `main()` appends outcome, duration, per-table DuckDB row counts, and nonzero failure counters to `$GITHUB_STEP_SUMMARY` when set (before the `--fail-on-partial` exit, so partial runs are summarized too).
- `scripts/push_duckdb_to_supabase.py`: PTCG-db publication requires `--include-ptcgdb` (default off; logs the skipped staged-row count); `refresh_post_push_data(sb, report)` records status/attempts/duration/reason per maintenance RPC; `main()` writes published row counts, publication duration, PTCG-db decision, and maintenance results to the step summary in a `finally` (so failures are summarized). Summary never includes URLs or keys; reasons are flattened and `|`-escaped.
- `.github/workflows/deploy-pages.yml` (v1 Pages; owner decision A): `--clear-failed --skip-japanese`, **no** `--fail-on-partial`, so the frozen v1 site keeps deploying through an upstream blip. v2's copy now matches what would go to `main`.

**Validation:**

- `python scripts/test_ingest.py` — 14 passed (3 new: CLI writes summary, partial-failure summary, missing tables skipped).
- `python scripts/test_push_duckdb_to_supabase.py` — 30 passed (11 new: PTCG-db skipped by default / published on opt-in / custom rows excluded / missing table; flag defaults off; maintenance outcomes recorded incl. fatal refresh; summary contents; unfinished publication; no key/URL in summary; reason escaping; summary append).
- `python scripts/test_jpn_card_key.py` — passed.
- `python scripts/push_duckdb_to_supabase.py --dry-run` against the local DuckDB with `GITHUB_STEP_SUMMARY` set: correct counts, "skipped 0 staged row(s)", maintenance "not run"; no Supabase writes.
- Simulated `bash -eo pipefail` loop confirms a failing script is detected through `tee`; redaction snippet replaces secret values and skips empty ones.
- Both workflow files parse as YAML (`actionlint` not installed locally; first real validation is a GitHub run).
- `npm run check:quick` — exit 0.

**Remaining risks:**

- The workflow changes are only exercised by a real Actions run. A v2 `workflow_dispatch` (owner approval required — it writes to production Supabase) would validate them before the `main` sync.
- First scheduled run from `main` after the sync starts without cached progress (~3.5 h observed); within the 300-min step timeout, but a slow upstream could exceed it. It is resumable; a second run would finish the gaps.
- The first `main` Pages run after the sync uses v2 `ingest.py` against the committed v1 `pokemon.duckdb` (additive tables only; empty Japanese tables will be created in it).
- Loading new PTCG-db cards now requires running the push manually with `--include-ptcgdb`.

**Review (2026-09-26, reviewing agent Claude Opus 5.5): APPROVED.**

- HEAD verified `954a5bd`; remote `main` verified `2e5543a` (matches the re-diff). Commit touches only the two workflows, `ingest.py`, `push_duckdb_to_supabase.py`, their tests, and docs — no `src/`, `package*.json`, or `supabase/` changes.
- Reran: `test_ingest.py` 14 OK, `test_push_duckdb_to_supabase.py` 30 OK, `test_jpn_card_key.py` passed, `npm run check:quick` exit 0.
- Workflow logic checked: push gated on `steps.ingest.outcome == 'success'`; cache save still `always() && outcome != 'skipped'`; step timeouts 300/45 under job 350 (< 360 cap); concurrency group shared, non-cancelling; `shell: bash` gives `-eo pipefail` (simulated locally: failing script detected through `tee` in both the retry loop and push step); redaction runs before upload and skips empty secrets; PTCG-db publish needs `--include-ptcgdb` (`ingest.py --push-supabase` never passes it, so it stays off); v1 `deploy-pages.yml` uses `--clear-failed --skip-japanese` without `--fail-on-partial`. `actions/upload-artifact@v7` tag exists.
- All nine checked 0B.3 boxes verified against the diff.
- Non-blocking hardening (owner-approved and **applied 2026-09-26** in `ingest-supabase.yml`; YAML re-parsed):
  1. If the redaction step itself errors, `Upload logs on failure` still runs (`failure()` stays true) and would upload unscrubbed logs. Applied: `id: redact` on the redaction step and `if: failure() && steps.redact.outcome == 'success'` on the upload.
  2. Python stdout is block-buffered when piped to `tee`: live logs lag, stdout/stderr interleave out of order in artifacts, and unflushed output is lost on a step-timeout kill. Applied: `PYTHONUNBUFFERED: "1"` in the job `env`.
- Watch on the first real run (not defects): a timed-out ingest step should show outcome `failure` and still save the cache; if ingest ends near 300 min and push is slow, the 350-min job cap could cancel the push before the view refresh (upserts are idempotent; `failure()` steps do not run on cancellation).

**Validation run (2026-09-26, owner-approved push + dispatch):** `954a5bd`/`7c59a25` pushed (`ff5a374..7c59a25`); v2 `workflow_dispatch` run [`36273193023`](https://github.com/CmdrKerfy/tropius-maximus/actions/runs/36273193023) — **success**, 8 min 27 s total.

- Token permissions: `Contents: read`, `Metadata: read`. Bash shell ran with `-e -o pipefail`; `PYTHONUNBUFFERED=1` set.
- Tests: push 30 OK, ingest 14 OK, jpn_card_key parity passed.
- Cache: restored `duckdb-Linux-36228427545-1`, saved `duckdb-Linux-36273193023-1`.
- Ingest: 58 s, outcome success, no resume pass needed (TCG 176 sets complete, 0 new; Pocket 15 sets, 0 new; Japanese 184 sets, 0 new).
- Publish gate: push ran (ingest success); "Report incomplete", redaction, and log upload correctly skipped (no failure → no artifact to inspect).
- Push: 7 min 11 s. Rows: sets TCG 176 / Pocket 15 / Japanese 184; `pokemon_metadata` 1,025; cards pokemontcg.io 20,670 / tcgdex Pocket 2,480 / tcgdex Japanese 12,781; PTCG-db "skipped 0 staged row(s)".
- Maintenance: `refresh_explore_filter_options` **failed twice with `57014` after ~69 s each**, succeeded on attempt 3/3 in 19.4 s; `ANALYZE` 18.4 s (attempt 1). The retry worked, but with zero retry headroom left — see risk below.
- Step summary panel: not retrievable via API/unauthenticated HTML; log output confirms the same data the summary is built from (code path unit-tested). Owner may eyeball the run page's summary panel.

**New findings from the run (not fixed; owner decisions):**

1. **tcgdex Japanese duplicates are live in production.** 8,451 `tcgdex`/`japanese` rows have a `ptcgdb` twin (`ptcgdb-<lower(set_id)>-<number without leading zeros>`; 98% same name). All were created 2026-09-26 07:15–08:14 UTC by recovery runs `36215951396`/`36228427545`, undoing the May dedup. Cause: `push_japanese_cards` upserts every tcgdex Japanese row with no cross-source check. None are annotated (0 annotations on any tcgdex Japanese card). `main`'s current scripts publish no Japanese cards, so **syncing to `main` would make the weekly schedule republish these twins** (no new rows while they exist, but any cleanup would be undone every Monday). Belongs to 1B. **Resolved 2026-09-26** — see 1B "tcgdex Japanese twin slice".
2. **Materialized-view refresh is near its timeout** after a full upsert (2 of 3 attempts hit `57014`). Next run could exhaust retries. Belongs to 0B.2 follow-up / Phase 5 (for example, run ANALYZE before refresh, a longer `statement_timeout` for the refresh RPC, or `REFRESH ... CONCURRENTLY`).

**Proposed `main` sync (not executed; needs explicit owner approval):** prepared 2026-09-26 as staged (uncommitted) changes in a temporary worktree on `origin/main` `2e5543a` (scratchpad `main-sync/`, full patch `main-sync.patch`, 8 files, +2,538/−142); tests pass in that tree (30/14/parity); `requirements-ci.txt` already identical. **Re-staged 2026-09-26 from v2 `ee01e4b`** (includes the 1B twin fix): 8 files, +2,734/−142, staged files identical to `ee01e4b`, tests 37/14/parity pass in the `main` tree. One commit on a temporary worktree based on `origin/main`, containing only `ingest-supabase.yml`, `deploy-pages.yml` (the one-flag change), `scripts/ingest.py`, `scripts/push_duckdb_to_supabase.py`, `scripts/jpn_card_key_utils.py`, and the three `scripts/test_*.py` files. No frontend, `package*.json`, or `site-checks.yml`.

#### 0B.4 Hotfix Workbench move RPC (pulled forward from 2A)

Independent of ingest work; may be done before or after 0B.2 at the owner's choice. Requires owner approval before applying the migration to production.

**Status:** Implemented 2026-09-26 (Claude Opus 5.5). Owner approved (including order-preserving dedupe); committed as `3907b09` (not pushed) and **applied to production 2026-09-26** as SQL via `execute_sql` (returned without error; not in the migration history table). The agent's post-apply read-only check was blocked by a tool permission rule; the owner ran it instead. **Accepted 2026-09-26.**

- [x] Reproduce first: confirm in the app (or via a rollback-transaction probe as an authenticated user) that moving cards between Workbench lists currently errors. Record the error text.
- [x] Create a new migration that replaces `move_workbench_cards` so it reads `card_ids` JSONB into `text[]` (for example via `jsonb_array_elements_text`) and writes back with `to_jsonb(...)`. Keep the existing signature `(bigint, bigint, text[], integer)` so the app call is unchanged.
- [x] Lock both queue rows in deterministic ID order (`ORDER BY id FOR UPDATE`) to reduce deadlock risk.
- [x] Preserve existing owner/shared permission checks, capacity (`p_max_cards`), duplicate handling, and missing-source-card behavior.
- [x] Test: owner move, shared-list move, duplicates, capacity overflow, and a card not present in the source list.
- [x] Owner approval, then apply as SQL (not `supabase db push`).
- [x] Post-apply check (query below: expect `true`, a hash of `799d5766b08055e15fd0e2fe63ffec13` matching the committed file, ACL unchanged) and signed-in QA of a real move in production. Owner ran both 2026-09-26: `fixed = true`, `src_md5 = 799d5766b08055e15fd0e2fe63ffec13`, ACL `{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}` (unchanged); moving cards between Workbench lists in the app passed.

**0B.4 results**

- **Reproduced (2026-09-26):** as the list owner (`SET LOCAL ROLE authenticated`, non-anonymous `request.jwt.claims`, rolled back), calling the deployed function (migration 038) to move one card from list 6 to list 2 fails with:
  `ERROR 42804: COALESCE types jsonb and text[] cannot be matched` at `v_source_ids := ARRAY(... unnest(COALESCE(v_source.card_ids, '{}'::text[])) ...)` — PL/pgSQL `move_workbench_cards` line 55. It fails before any write, so every move in production fails.
- **Migration:** `supabase/migrations/20260926210118_workbench_move_cards_jsonb.sql` (created with `supabase migration new`). `CREATE OR REPLACE`, same signature and return columns, still `SECURITY INVOKER` + `search_path = public` (RLS provides owner/shared visibility; the `trg_enforce_workbench_list_owner_controls` trigger still limits non-owners to content fields). The existing ACL is kept (`PUBLIC`/`anon` execute remain; anonymous calls are rejected by the sign-in check; revocation is Phase 2C).
  - Reads with `jsonb_array_elements_text`, writes with `to_jsonb(text[])` (empty → `[]`). A non-array `card_ids` raises an explicit error instead of silently becoming empty.
  - Locks both rows with one `PERFORM ... WHERE id IN (src, tgt) ORDER BY id FOR UPDATE` before reading either.
  - **Intentional behavior change (owner-approved 2026-09-26):** duplicates are removed while preserving list order (first occurrence wins, via `WITH ORDINALITY`). 038's `SELECT DISTINCT` gave no order guarantee, which could reshuffle lists and move `current_index` to a different card.
  - Unchanged: trimming and blank removal; cards already in the target count as `skipped_existing` and leave the source; overflow counts as `skipped_capacity` and stays in the source; requested cards not in the source are ignored and not counted; `current_index` clamped to the new lengths; same error messages.
- **Tests (2026-09-26, one transaction that applied the new function, created temporary lists, and ended in a forced exception so everything rolled back):** as `authenticated` with the real owner and a real second user's JWT claims.

  | Case | Result |
  | --- | --- |
  | Owner move; request `[c1, c3, zz, c1, ' c1 ']`; source `[c1,c2,c3,' c2 ',c4,'',c5]`, target `[c9,c3]` | moved 1, skipped_existing 1 (`c3`), `zz` ignored; source `[c2,c4,c5]`, target `[c9,c3,c1]`; source `current_index` 6 → 2 |
  | Capacity overflow (`p_max_cards` 3, target has 2) | moved 1, skipped_capacity 2; overflow stays in source `[c4,c5]` |
  | Only cards not in source | all counts 0; lists unchanged |
  | Same source and target | `Source and target lists must be different.` |
  | Non-owner: shared list → own list | moved 1; owner-controls trigger allows it |
  | Non-owner: own list → shared list | moved 1 |
  | Non-owner: another user's private list as source / target | `Source Workbench list not found.` / `Target Workbench list not found.` |
  | Anonymous session | `Sign in required for Workbench lists.` |
  | Stored element types after moves | all JSON strings |

  Post-rollback check: the deployed function source hash (`ceb03317…`) and ACL are unchanged; no test rows remain; the three real lists (ids 2, 6, 7) have unchanged lengths, indexes, and `updated_at`.
- **Not tested here:** concurrent moves (Phase 2A); the PostgREST/app path (confirm with signed-in QA after applying). The tested SQL matched the migration file except for two comment lines.
- **Apply (after owner approval):** run the migration file's SQL once in the SQL editor or via `execute_sql` (like 030–057 and 0B.2; it will not be in the migration history table). Then verify: `SELECT position('jsonb_array_elements_text' in prosrc) > 0 AS fixed, md5(prosrc) AS src_md5, proacl FROM pg_proc WHERE proname = 'move_workbench_cards';` (expected `fixed = true`, `src_md5 = 799d5766b08055e15fd0e2fe63ffec13`, ACL `{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}`) and move a card between two Workbench lists in the app.

Acceptance:

- Site Checks is green and exercises the Python ingest tests.
- Canonical set-ID grid and count queries succeed for representative TCG and Pocket sets as an authenticated user. (Met — 0B.1.)
- The maintenance timeout budget allows the refresh and `ANALYZE` to complete via the ingest's RPC path, with recorded durations.
- Materialized-view refresh retries transient failures and fails the workflow after exhaustion.
- Workbench move succeeds for owner and shared lists in production.
- Specialty/Action/Pose options include authoritative database values.
- No fallback silently presents a 5,000-row partial scan as complete.
- The default branch contains one internally compatible ingest unit.
- The workflow cannot overlap another ingest publication.

### 0C. Recover production freshness

- [ ] Run `workflow_dispatch` from the corrected default branch.
- [ ] Confirm ingest, publication, materialized-view refresh, and planner-statistics refresh all succeed.
- [ ] Treat materialized-view refresh failure as fatal; `ANALYZE` may remain nonfatal only after retry and explicit reporting.
- [ ] Record source row counts, duration, ingest run time, and refresh time in the GitHub step summary.
- [ ] Verify in Supabase:
  - counts by origin,
  - newest trustworthy observation time,
  - no unexpected Japanese cross-source overlap,
  - `explore_filter_options` freshness,
  - representative Explore query succeeds as an authenticated user,
  - Pocket coverage is reported honestly against the selected upstream; do not describe the catalog as complete while TCGdex still stops at `B2a`.

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

Partial progress: `4493d76` replaced whole-source Pocket/Japanese skipping with missing-ID reconciliation. It does not detect upstream corrections to existing rows and does not make observation timestamps truthful.

- [ ] Add an `ingest_run_id` and source-level run manifest.
- [ ] Track when each row was actually observed upstream.
- [ ] Update `last_seen_in_api` only for rows fetched in the current successful source run.
- [x] Replace whole-source “table nonempty” skipping for Pocket/Japanese with missing-card-ID reconciliation. (`4493d76`; correction/full-refresh policy remains below.)
- [ ] Count only non-custom cards when deciding whether an English set is complete.
- [ ] Define periodic full-refresh cadence for corrections to prices, rarity, names, and images.
- [ ] Mark unseen rows stale after a complete source run; do not automatically delete.

### 1B. Remove duplicate/collision hazards

- [ ] Disable automatic PTCG-db ingest/push during ordinary runs.
- [ ] Do not create PTCG-db staging tables unless the explicit source flag is enabled.
- [ ] Use a canonical Japanese key and documented source preference before publishing any future PTCG-db data. (Partial: source preference PTCG-db > TCGdex Japanese is now enforced at publish time — see slice below.)
- [ ] Protect manual cards and cross-origin IDs with server-side conflict logic:
  - update only when existing origin matches incoming origin,
  - report collisions,
  - never silently convert manual cards to API cards.

**tcgdex Japanese twin slice (2026-09-26, owner-approved, done):**

- Cause: `push_japanese_cards` upserted every TCGdex Japanese row; the May dedup was undone by the 2026-09-26 recovery runs (8,451 twins re-created 07:15–08:14 UTC).
- Fix `ee01e4b` (pushed): before publishing TCGdex Japanese rows, read published PTCG-db IDs from Supabase (keyset-paged, 1,000/page) plus staged IDs under `--include-ptcgdb`; skip any row whose twin ID `ptcgdb-<lower(set_id)>-<normalized number>` (same rule as `ingest.py`) matches. Skipped count is logged and appears in the step summary as "tcgdex Japanese skipped (PTCG-db twin)". Dry run cannot check twins (no client) and says so. 7 new tests (push suite 37 OK); `npm run check:quick` exit 0.
- Production cleanup (owner-approved): verified 0 annotations / edit_history / batch_selections / workbench_queues references; the only FK to `cards` is annotations. Guarded `DO` block deleted exactly 8,451 unannotated `tcgdex` twins (aborts on any other count). After: tcgdex Japanese 4,330, ptcgdb 19,705, Pocket 2,480 (unchanged). Ran `refresh_explore_filter_options()` and `analyze_cards_and_annotations()`. 107 TCGdex Japanese `sets` rows now have no cards; they are not shown in Explore because the view builds Japanese set options only from sets with cards. No backup table (rows are reproducible API data).
- Expected on the next push: "tcgdex Japanese skipped (PTCG-db twin)" ≈ 8,451, tcgdex Japanese published ≈ 4,330.

### 1C. Add robust retries and atomic boundaries

Partial progress: `79267ef` added one workflow-level resume attempt and a bounded second pass for transient Pokémon TCG set failures. The generalized retry, staging, and atomic publication work remains.

- [ ] Reuse an `httpx.Client`.
- [ ] Retry 408, 429, 5xx, connection resets, and gateway timeouts with exponential backoff, jitter, and `Retry-After`.
- [ ] Include swallowed PokeAPI enrichment failures in partial-failure accounting.
- [ ] Fetch into DuckDB staging tables, validate, then swap transactionally.
- [ ] Publish to Postgres staging and finalize one source transactionally.
- [ ] Batch by payload bytes as well as row count.
- [ ] Refresh derived views only after successful finalization.

### 1D. Fix cache and artifact authority

Partial progress: `79267ef` introduced run-attempt-specific save keys with a stable restore prefix and saves incomplete progress for later resumption. Cache identity and authority are not yet complete.

- [x] Use run-specific cache save keys with a stable restore prefix for resumable progress. (`79267ef`)
- [ ] Include dependency/schema/helper hashes in cache identity.
- [ ] Generate a manifest containing source status, counts, checksums, schema version, and run ID.
- [ ] Keep Pages and Supabase consumers on the same validated weekly snapshot where practical.

### 1E. Replace/harden Pokémon TCG Pocket ingestion

**Status:** Not started; distinct workstream. It must not block unrelated Phase 0B filter/UI fixes or later frontend performance work. It does block claiming the Pocket catalog is complete or current.

Guardrails:

- Do not perform a blind source replacement or delete/reinsert Pocket rows.
- Preserve every existing canonical card ID unless a reviewed mapping and transactional foreign-key migration proves a change safe. IDs are referenced by annotations, edit history, pins, queues/lists, batch data, and public links.
- Never overwrite annotation rows, annotation overrides, edit history, ownership/user fields, or manual cards during source reconciliation.
- Keep deterministic source precedence and provenance. Do not label replacement-source records as TCGdex without an explicit provenance decision.
- Pin external input to a reviewed release/commit plus checksum; do not ingest mutable `main` without recording the exact revision.
- Treat third-party metadata licensing separately from Pokémon artwork redistribution rights.

#### 1E.1 Source/schema comparison and canonical mapping

- [ ] Compare TCGdex, `pokemon-tcg-pocket-database`, current DuckDB `pocket_*` tables, and Supabase `cards`/`sets` field by field.
- [ ] Inventory all 23 currently listed alternative-source sets and expected card counts; explicitly reconcile the eight sets missing from TCGdex.
- [ ] Define canonical set mapping, including `PROMO-A` → `P-A` and `PROMO-B` → `P-B`.
- [ ] Prove canonical card-ID mapping for normal, secret/alternate-art, and promo cards; report collisions and unmapped rows.
- [ ] Decide how source provenance is stored without breaking current Explore source grouping.

#### 1E.2 Importer adapter with fixture tests

- [ ] Implement a source adapter that emits the existing canonical Pocket row shape.
- [ ] Use `pokemon-tcg-pocket-database` as the proposed primary catalog and TCGdex only as explicit fallback/enrichment after comparison confirms field precedence.
- [ ] Add fixtures for an existing set, each promo family, an alternate-art number, a post-`B2a` set, missing image metadata, and conflicting source values.
- [ ] Make existing-row reconciliation update approved API-owned fields instead of fetching only new IDs.
- [ ] Verify idempotency across two identical runs.

#### 1E.3 Dry-run reconciliation

- [ ] Produce a no-write report against current DuckDB and Supabase data:
  - inserts, metadata updates, image backfills, unchanged rows,
  - canonical-ID collisions and duplicate semantic cards,
  - rows absent from each source,
  - expected versus actual counts by set,
  - foreign-key references that would be affected.
- [ ] Require zero destructive ID changes, orphaned annotations/history, or unexpected deletions before production approval.

#### 1E.4 Image backfill and optional Supabase Storage mirroring

- [ ] First prove source image URL construction/availability and backfill missing URLs without changing card IDs.
- [ ] Before mirroring artwork, obtain an explicit owner decision after reviewing source terms and artwork redistribution rights; the upstream MIT repository license alone is insufficient evidence.
- [ ] If mirroring is approved, use a dedicated bucket/path policy, service-role ingest only, explicit MIME types, checksums, bounded concurrency, and versioned/content-addressed paths rather than overwriting CDN objects.
- [ ] Define public/private bucket access and RLS/ACL behavior; never expose the service key.
- [ ] Estimate object count, storage, egress, and retry cost before bulk upload.

#### 1E.5 Production reconciliation

- [ ] Publish through staging/validation with source-scoped upserts and deterministic field precedence.
- [ ] Verify annotations, edit history, pins, queues/lists, batch references, overrides, and public links retain their original card IDs.
- [ ] Verify expected set/card counts, duplicate-ID count, missing-image count, and representative old/new/promo cards.
- [ ] Do not delete unseen Pocket cards automatically; mark/report stale rows after a complete source run.
- [ ] Capture a rollback manifest and pre-push counts/checksums.

#### 1E.6 Scheduled freshness and fallback behavior

- [ ] Record source revision/release, checksum, observed-at time, expected sets/cards, and image-availability summary in every run.
- [ ] Fail visibly when the primary Pocket source is stale, incomplete, structurally changed, or below expected set/card thresholds.
- [ ] Document when TCGdex fallback is allowed and whether fallback may insert, enrich, or only report.
- [ ] Alert on missing expected sets, count regressions, duplicate canonical IDs, and image-availability regressions.

Pocket acceptance:

- All expected sets through the reviewed source release are present under canonical IDs.
- Existing foreign-key/user data remains attached to the same cards.
- Two identical runs are idempotent and do not falsely refresh observation timestamps.
- Missing/incomplete Pocket data cannot produce a green workflow without an explicit, visible degraded-state policy.

Validation:

- Fixture-based transform and reconciliation tests.
- Mocked 429/5xx/timeout tests.
- Interrupted-run test proving prior published data remains intact.
- Duplicate/cross-origin collision tests.
- Two consecutive runs proving unchanged data is not falsely re-observed.
- Pocket dry-run reconciliation and foreign-key integrity report.

Phase gate:

- [ ] Reviewer confirms observation timestamps, stale marking, collision handling, and interrupted-run behavior.

---

## Phase 2 — Database correctness and authorization

**Priority:** High  
**Status:** Not started  
**Dependency:** Phase 0; may proceed in parallel with Phase 1 after recovery

Create separate migrations for each subsection.

### 2A. Repair Workbench move RPC

**Moved to Phase 0B.4** (2026-09-26 review; 0B.4 migration `20260926210118_workbench_move_cards_jsonb.sql` written and tested, not yet applied). Deployed `card_ids` type (`jsonb`) and function body (`text[]` only) were confirmed. What remains here after 0B.4 lands:

- [ ] Concurrent-move test (two simultaneous moves between the same pair of lists).

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
**Dependency:** Phase 0B.4 for Workbench move QA

The active set-ID timeout and filter-option completeness defects were promoted to Phase 0B because they block the Phase 0C authenticated Explore acceptance check. Keep the broader cache/render/save work in this phase.

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

**Priority:** Medium (optional — confirm with owner before starting; see Plan review 2026-09-26)  
**Status:** Not started  
**Dependency:** Phases 2–4

Do not add indexes or replace hosting based only on static review.

### Measurement matrix

Capture authenticated browser timing, PostgREST timing, and `EXPLAIN (ANALYZE, BUFFERS, SETTINGS)` where safe:

1. Default TCG and All browse, first and deep pages.
2. ASCII `pikachu` and CJK `イーブイ` searches.
3. Canonical set-ID filter (ID-only since `bff91cc`; `set_name` OR already removed).
4. Scalar and JSONB annotation filters.
5. Annotation-sourced artist filter.
6. Exact counts for broad and selective filters.
7. `get_form_options_db`.
8. `get_annotation_value_issues`.
9. Recent edit history.

### Candidate optimizations, only if measurements support them

- [x] Remove `set_name` OR when UI already supplies canonical set IDs. (`bff91cc`)
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

**Priority:** Medium (optional — confirm with owner before starting; RUM, structured logs, and bundle budgets are likely overkill for 1–3 users)  
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
- [ ] If a later branch merge is considered, run the link/routing-safe merge gate in `docs/plans/p1-cutover-and-operations.md` §6 before changing `main` or Vercel's Production Branch.

## Exact next action

0B.3 is validated (run `36273193023`), and the 1B tcgdex-twin slice is done: fix `ee01e4b` pushed, 8,451 production twins deleted. The ingest-only `main` sync is re-staged from `ee01e4b` (uncommitted) in a scratchpad worktree on `origin/main` `2e5543a`; patch `main-sync.patch`. Next single step: owner explicitly authorizes committing and pushing that sync to `main` (then remove the worktree). After that: add timeout headroom for the materialized-view refresh (2/3 attempts hit `57014` in the validation run), then 0C. Phase 1E.1–1E.3 (no-write) may start in parallel. Shelved: mobile zoomed-out load (not reproduced); non-TCG Japanese collectibles (Carddass/Topsun/etc.) parked as a separate idea pending owner scope decision. Do not run `supabase db push` (remote history tracks only 001–029). Do not commit/push `main`, delete production rows, dispatch ingest, or begin Phase 1E production writes without explicit owner authorization.
