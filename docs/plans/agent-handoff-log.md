# Agent Handoff Log

Use this file at every clean break so another agent can continue immediately if usage limits are hit.

## Required preflight before next phase or major edit

Before starting the next phase of any plan (or any major edit/refactor/migration), the agent must send this preflight to the owner and wait for acceptance:

1. **Model check (Auto mode):** state the exact model in use and ask for acceptance.
2. **Token feasibility:** state whether the requested work is likely completable within remaining token limits.
3. **Proceed prompt:** ask whether to continue with full scope or a scoped slice.

If token feasibility is **unlikely**, the agent must propose:
- a scoped slice that fits the remaining budget, and
- the clean-break handoff point it will leave in this file.

## How to update (required at clean breaks)

1. Add a new dated entry at the top.
2. Keep it short, concrete, and executable.
3. Reference exact files, migrations, and commands where relevant.
4. Include one explicit "Next action" that can be started without extra context.

---

## Entry Template

### YYYY-MM-DD HH:MM (local) - Agent/session label

- Preflight sent and accepted:
  - Model accepted: yes/no
  - Token-feasibility declared: likely/unlikely
  - Scope selected: full/scoped
- Branch: `v2/supabase-migration`
- Plan doc: `docs/plans/<active-plan>.md`
- Scope in this slice:
  - ...
- Completed:
  - ...
- Validation run:
  - `npm run check:quick` (pass/fail)
  - Any manual QA:
- Migrations touched:
  - `supabase/migrations/<id>_<name>.sql` (applied/not applied)
- Open risks or assumptions:
  - ...
- Next action (single first step):
  - ...

---

### 2026-09-26 (local) - Phase 0B.3 review: APPROVED

- Preflight: model Claude Opus 5.5; token feasibility likely; scope full (review only).
- Branch: `v2/supabase-migration` at `954a5bd` (verified). Plan: `docs/plans/system-performance-ingest-reliability-remediation.md` (0B.3 "Review").
- Completed: reviewed `git show 954a5bd`; verified all nine checked 0B.3 boxes; confirmed remote `main` = `2e5543a`; checked publish gate, timeouts (300/45/350), concurrency, `bash` pipefail + `tee` (simulated), redaction-before-upload, PTCG-db opt-in, v1 `--skip-japanese`.
- Validation: `test_ingest.py` 14 OK; `test_push_duckdb_to_supabase.py` 30 OK; `test_jpn_card_key.py` pass; `npm run check:quick` exit 0.
- Migrations touched: none.
- Review fixes (owner-approved, applied, committed with the review notes): upload log artifact only if redaction succeeded; `PYTHONUNBUFFERED=1` in the job env.
- Open risks: workflow still unexercised by a real Actions run. Nothing pushed, dispatched, or synced to `main`.
- Next action: owner decides on a v2 `workflow_dispatch` validation run (writes to production Supabase), then on the ingest-only `main` sync listed under 0B.3 "Proposed `main` sync".

### 2026-09-26 (local) - Phase 0B.3 v2-side hardening (awaiting review)

- Preflight sent and accepted:
  - Model accepted: yes (Claude Opus 5.5)
  - Token-feasibility declared: likely
  - Scope selected: scoped (v2-side 0B.3 only; no `main` changes)
- Branch: `v2/supabase-migration`; the three 0B.4 commits were pushed at the owner's request (`955aaa3..ff5a374`).
- Plan doc: `docs/plans/system-performance-ingest-reliability-remediation.md` (0B.3 section has the re-diff table, findings, implementation, validation, and proposed `main` sync).
- Owner decisions: (A) v1 Pages ingest gets `--skip-japanese` but **not** `--fail-on-partial`; (B) PTCG-db publication is opt-in via `push_duckdb_to_supabase.py --include-ptcgdb`, with no workflow input.
- Completed:
  - Re-diffed the ingest unit against remote `main` `2e5543a` (local `main` is stale). `jpn_card_key_utils.py` and all three tests are absent on `main`; `requirements-ci.txt` is identical.
  - `ingest-supabase.yml`: read-only permissions, non-cancelling concurrency, job/step timeouts (350/300/45 min), pipefail + `tee` logs, jpn parity test, "Publication skipped" summary, secret-scrubbed log artifact on failure.
  - `ingest.py` / `push_duckdb_to_supabase.py`: step summaries (row counts, durations, refresh/ANALYZE results); PTCG-db opt-in gate.
  - `deploy-pages.yml`: `--clear-failed --skip-japanese`.
- Validation run:
  - `npm run check:quick` (pass); `test_ingest.py` 14 passed; `test_push_duckdb_to_supabase.py` 30 passed; `test_jpn_card_key.py` passed.
  - Local `push_duckdb_to_supabase.py --dry-run` with `GITHUB_STEP_SUMMARY` set rendered the expected summary; no writes.
  - Workflow YAML parses; pipefail/tee and redaction behavior simulated locally. Not yet exercised on GitHub Actions.
- Migrations touched:
  - None.
- Open risks or assumptions:
  - Workflow changes are unproven until a real Actions run; first `main` run starts without cached progress (~3.5 h observed).
  - `main` is untouched; the sync needs explicit owner approval.
- Next action (single first step):
  - Owner reviews the 0B.3 commit and decides whether to validate via a v2 `workflow_dispatch` (writes production Supabase) and whether to authorize the ingest-only `main` sync.

---

### 2026-09-26 (local) - Phase 0B.4 accepted

- Continuation of the 0B.4 session (Claude Opus 5.5).
- Owner post-apply check: `fixed = true`, `src_md5 = 799d5766b08055e15fd0e2fe63ffec13` (matches the committed function body), ACL unchanged. Owner moved cards between Workbench lists in the app on Vercel: passed.
- Branch: `v2/supabase-migration`; 0B.4 commits are local, **not pushed** (push only when the owner asks). `main` untouched.
- Open risks: concurrent moves untested (Phase 2A); `PUBLIC`/`anon` EXECUTE remains (Phase 2C). Remote migration history still tracks only `001`–`029`; never run `supabase db push`.
- Next action (single first step):
  - Owner decides whether to push the 0B.4 commits, then which slice is next (0B.3 needs explicit `main` authorization; otherwise 0C or 1E.1–1E.3).

---

### 2026-09-26 (local) - Phase 0B.4 committed and applied

- Preflight: continuation of the accepted 0B.4 session (Claude Opus 5.5); owner approved order-preserving dedupe, commit, and applying the migration.
- Branch: `v2/supabase-migration` — `3907b09` committed locally, **not pushed**; `main` untouched.
- Migration applied to production as SQL via `execute_sql` (no error returned; untracked in migration history like 030–057):
  - `supabase/migrations/20260926210118_workbench_move_cards_jsonb.sql`
- Validation:
  - Pre-apply rolled-back tests passed (see the previous entry and the plan's "0B.4 results").
  - Post-apply read-only check **not run by the agent** (blocked by a tool permission rule). Expected: `fixed = true`, `src_md5 = 799d5766b08055e15fd0e2fe63ffec13` (hash of the committed function body), ACL unchanged.
- Open risks:
  - Deployment is unconfirmed until the post-apply check and a signed-in app move pass.
  - Concurrent moves untested (Phase 2A); `PUBLIC`/`anon` EXECUTE remains (Phase 2C).
  - Owner screenshots `tests/IMG_6879.jpg`, `tests/IMG_6880.jpg` remain untracked; do not commit.
- Next action (single first step):
  - Owner runs the post-apply check query and moves a card between two Workbench lists in the app; then mark 0B.4 accepted and decide whether to push `3907b09`.

---

### 2026-09-26 (local) - Phase 0B.4 Workbench move hotfix (migration written and tested; not applied, not committed)

- Preflight sent and accepted:
  - Model accepted: yes (Claude Opus 5.5, `claude-opus-5-5`)
  - Token-feasibility declared: likely
  - Scope selected: 0B.4 only
- Branch: `v2/supabase-migration` at pushed `955aaa3`; nothing committed, pushed, applied, or dispatched; `main` untouched.
- Plan doc: `docs/plans/system-performance-ingest-reliability-remediation.md` (0B.4 checklist + "0B.4 results")
- Completed:
  - Reproduced as the owner (rolled back): `ERROR 42804: COALESCE types jsonb and text[] cannot be matched` (038 function, line 55). Every production move fails before writing.
  - New migration `supabase/migrations/20260926210118_workbench_move_cards_jsonb.sql`: JSONB read (`jsonb_array_elements_text`) and write (`to_jsonb`), same signature, both rows locked `ORDER BY id FOR UPDATE`, SECURITY INVOKER + RLS unchanged, ACL kept. Order-preserving dedupe replaces 038's `SELECT DISTINCT` (recommended; owner to confirm).
- Validation run:
  - One rolled-back transaction as `authenticated` with the owner's and a second real user's claims: owner move, duplicates, already-in-target, capacity overflow, not-in-source, same list, shared list in both directions, other user's private list (not found), anonymous (sign-in required), all stored elements JSON strings. All as expected (table in plan).
  - After rollback: deployed function hash/ACL unchanged, no test rows, real lists 2/6/7 unchanged.
  - `npm run check:quick` not run (no app code changed).
- Migrations touched:
  - `supabase/migrations/20260926210118_workbench_move_cards_jsonb.sql` (created, **not applied**)
- Open risks or assumptions:
  - Concurrent moves untested (Phase 2A). The app/PostgREST path is confirmed only by signed-in QA after applying.
  - `PUBLIC`/`anon` still hold EXECUTE (rejected at runtime by the sign-in check; Phase 2C).
  - Remote migration history tracks only `001`–`029`; never run `supabase db push`.
  - Owner screenshots `tests/IMG_6879.jpg`, `tests/IMG_6880.jpg` remain untracked; do not commit.
- Next action (single first step):
  - Owner reviews the migration; on approval, commit it with the plan/log updates, apply its SQL once, run the post-apply check, and move a card between two lists in the app.

---

### 2026-09-26 (local) - Phase 0B.2 committed, pushed, and migrations applied

- Preflight: continuation of the accepted 0B.2 session (Claude Opus 5.5); owner approved commit, push, and applying migrations.
- Branch: `v2/supabase-migration` — `6f36a0d` (0B.2), `3bde76b` (Pocket badge fix), pushed `bff91cc..3bde76b`; Vercel auto-deploys. `main` untouched.
- Migrations applied to production (as SQL, in order; untracked in migration history like 030–057):
  1. `20260926092111_service_role_maintenance_timeout.sql` — `service_role` rolconfig now `statement_timeout=60s, lock_timeout=60s`.
  2. `20260926092113_refresh_explore_filter_options_concurrently.sql` — verified CONCURRENTLY, `search_path=""`, ACL unchanged.
  3. `20260926092115_explore_filter_options_annotation_facets.sql` — 4 rows, `facets_version` 1, specialties ACE SPEC/Pokémon Tool/Pokémon Tool F/Technical Machine, 42 actions, 32 poses; ACL SELECT for authenticated + service_role only.
- Validation: as `service_role` with 60 s limit — refresh 7.5 s, ANALYZE 12.5 s; authenticated read of the view OK; `npm run check:quick` pass before push.
- Open risks:
  - PostgREST/service-key path not exercised by the agent (no key access); confirm on the next ingest run's log.
  - Remote migration history tracks only `001`–`029`; never run `supabase db push`.
  - Mobile zoomed-out load shelved (not reproduced). Remaining stale `VITE_USE_FILTER_OPTIONS_RPC` doc references listed in the plan.
  - Owner screenshots `tests/IMG_6879.jpg`, `tests/IMG_6880.jpg` are untracked; do not commit.
- Next action (single first step):
  - Phase 0B.4: reproduce the Workbench move error as an authenticated user and record the error text.

---

### 2026-09-26 (local) - Phase 0B.2 implemented (uncommitted; migrations created, not applied)

- Preflight sent and accepted:
  - Model accepted: yes (Claude Opus 5.5, `claude-opus-5-5`)
  - Token-feasibility declared: likely
  - Scope selected: full 0B.2
- Branch: `v2/supabase-migration` at pushed `bff91cc`; nothing committed, pushed, deployed, or dispatched; `main` untouched.
- Plan doc: `docs/plans/system-performance-ingest-reliability-remediation.md` (0B.2 checklist + "0B.2 results")
- Completed:
  - Timeout budget migration (`service_role` statement/lock timeout 60 s + `NOTIFY pgrst, 'reload config'`); docs cited. **Flag:** 60 s instead of the preferred 120 s because Supabase documents a 60 s max for Client API queries.
  - CONCURRENTLY refresh migration (SECURITY DEFINER, `search_path = ''`, ACL unchanged).
  - View facets migration: Specialty (card subtypes), Action/Pose (annotations) in the `tcg` row + `facets_version: 1`; recreated view grants SELECT to authenticated/service_role only.
  - Push script: bounded retry/backoff (3 attempts, 5 s/15 s); refresh exhaustion fatal with `::error`; ANALYZE exhaustion nonfatal with structured `::warning`.
  - Explore filter options: view → automatic split-RPC fallback → explicit error with Retry; facets degrade alone (static lists + amber notice); live sets overlay on both paths; no client-paged 5,000-row path; capped form-option helpers now throw instead of truncating.
- Validation run:
  - `npm run check:quick` (pass, exit 0); Python push tests 19 passed; new Node tests 16 passed.
  - Migrations: `pglast` parse-only OK; full new view query `PREPARE`d against live schema OK; not applied.
  - Read-only authenticated timings: split RPCs TCG 704 ms, Pocket 609 ms, Custom 24 ms, Japanese 1,662 ms; standalone facet RPC 6.3 s cold / 2.5 s warm (rejected); facet CTEs add ~5.1 s to refresh.
- Migrations touched (all **created, not applied**; apply in this order with owner approval):
  1. `supabase/migrations/20260926092111_service_role_maintenance_timeout.sql`
  2. `supabase/migrations/20260926092113_refresh_explore_filter_options_concurrently.sql`
  3. `supabase/migrations/20260926092115_explore_filter_options_annotation_facets.sql`
- Open risks or assumptions:
  - **Until migration 1 is applied, any v2 ingest run will go red at the refresh step. This is expected, not a regression.**
  - Post-migration durations are estimates (~17 s refresh) until the timed service-key RPC check runs.
  - Stale `VITE_USE_FILTER_OPTIONS_RPC` / client-paged references remain in `CLAUDE.md` and several `docs/plans/*` files (left untouched to keep the diff scoped and preserve pending edits).
  - New migrations use CLI timestamp names; existing ones use `NNN_`. Check remote migration history format before `db push`.
  - Owner QA: Pocket badge on Japanese cards fixed in the working tree (`src/lib/cardSource.js`, separate commit from 0B.2); mobile zoomed-out load not reproduced — needs details. Owner chose to keep the 60 s timeout.
- Next action (single first step):
  - Owner reviews the uncommitted 0B.2 diff (including 60 s vs 120 s); on approval, commit, then apply migrations 1→2→3 and run the timed refresh/ANALYZE RPC verification.

---

### 2026-09-26 (local) - Independent plan review; corrections applied to remediation plan

- Preflight sent and accepted:
  - Model: Claude Opus 5.5 (owner-requested review)
  - Token-feasibility declared: likely
  - Scope selected: review + documentation corrections only
- Branch: `v2/supabase-migration` at `bff91cc`; `main` untouched. No code, migration, or deploy changes.
- Plan doc: `docs/plans/system-performance-ingest-reliability-remediation.md` (new section "Plan review 2026-09-26")
- Completed:
  - Checked plan claims against code and the live Supabase DB (read-only `pg_roles`, `pg_attribute`, `pg_proc` queries).
  - **Found the root cause of the `57014` failures:** `service_role` has no `rolconfig`, so PostgREST RPCs inherit `authenticator`'s `statement_timeout=8s` / `lock_timeout=8s`. The MV refresh takes ~12 s, so the planned "retry then fail" would make every weekly run red without refreshing. 0B.2 now fixes the timeout budget first (preferred: `ALTER ROLE service_role SET statement_timeout`), then adds retries and a CONCURRENTLY refresh.
  - **Found a production bug:** live `workbench_queues.card_ids` is `jsonb`, but deployed `move_workbench_cards` uses `text[]` with no conversion, so moves should error. Pulled forward from Phase 2A to new slice 0B.4.
  - 0B.2 now requires an explicit source for Specialty/Action/Pose (neither the MV nor the split RPCs supply them).
  - Fixed stale text: 0B.1 acceptance is reflected everywhere; the Phase 5 `set_name` OR removal is marked done (`bff91cc`). Phases 5–6 are marked optional pending owner confirmation.
- Validation run:
  - Documentation-only; no code validation run.
- Migrations touched:
  - None (0B.2 timeout and 0B.4 move-RPC migrations are specified, not written).
- Open risks or assumptions:
  - It is not yet verified that PostgREST applies an `ALTER ROLE service_role SET statement_timeout` to impersonated requests; confirm in the docs and by a timed RPC call after applying.
  - The Workbench move failure is inferred from the deployed types and function body; reproduce it in the app before fixing.
  - Other pre-existing modified/untracked files remain untouched.
- Next action (single first step):
  - Ask the owner whether to do 0B.4 (Workbench move hotfix) before or after 0B.2; then start with that slice's first reproduce/verify step. Applying any production migration requires explicit owner approval.

---

### 2026-09-26 01:47 (local) - Phase 0 plan reconciliation after manual ingest recovery

- Preflight sent and accepted:
  - Model accepted: yes (`GPT-5.6 Sol`, accepted earlier in this session)
  - Token-feasibility declared: likely
  - Scope selected: documentation reconciliation only
- Branch: `v2/supabase-migration` at pushed commit `bff91cc`; `main` untouched.
- Plan doc: `docs/plans/system-performance-ingest-reliability-remediation.md`
- Completed:
  - Reconciled the plan with pushed commits `79267ef`, `4493d76`, and `597532d`.
  - Recorded the successful manual publication and the swallowed `57014` failures from run `36228427545`; latest run output reported 12,781 TCGdex Japanese rows.
  - Split Phase 0B into: trustworthy Site Checks/indexed set queries, post-push/filter-option correctness, and a recalculated owner-approved default-branch sync.
  - Recorded partial Phase 1 progress for incremental TCGdex reconciliation, bounded resume behavior, and run-specific progress caches.
  - Promoted the set-query timeout and incomplete Specialty/Action/Pose/fallback behavior into Phase 0B because they block Phase 0C authenticated Explore acceptance.
  - Reconciled concurrently completed commit `bff91cc`: set-ID-only grid/count filtering and Python-enabled Site Checks are pushed; GitHub Site Checks run `36230895162` passed.
  - Expanded `docs/plans/p1-cutover-and-operations.md` §6 with a deferred owner-only merge gate that preserves Vercel routing, Supabase URL/auth redirects, and intentional GitHub Pages behavior.
  - Added distinct Phase 1E for Pocket source replacement/hardening after verifying TCGdex exposes 15 sets through `B2a` while `pokemon-tcg-pocket-database` 2.10.0 lists 23, including eight newer/missing sets.
  - Added canonical-ID/foreign-key guardrails, promo set mapping, fixture adapter, dry-run reconciliation, optional Storage/image rights gate, production integrity checks, and scheduled source-freshness monitoring.
  - Owner completed signed-in Phase 0B.1 QA: `me55`, `B2a`, and combined Source=All filtering load cards/counts without query errors. Phase 0B.1 is accepted.
- Validation run:
  - Documentation-only update; no code validation run in this slice.
  - Verified latest remote branch state and GitHub run logs.
- Migrations touched:
  - None.
- Open risks or assumptions:
  - Other pre-existing modified/untracked files remain unrelated and untouched.
  - Automated hosted access remains blocked here by Vercel Deployment Protection (403) plus application email authentication; the owner supplied the signed-in QA result.
  - Most `B2a` images remain missing despite successful set queries. This is Phase 1E data-quality work, not a Phase 0B.1 query failure. Source replacement is not authorized, and image mirroring requires a separate artwork-rights/Storage-policy owner decision.
  - Materialized-view refresh still stays green after exhausted `57014`; Specialty/Action/Pose and capped fallback fixes are not implemented.
  - No `main` authorization has been given.
- Next action (single first step):
  - Start only Phase 0B.2 post-push maintenance/filter-option work and stop for review afterward; do not begin Phase 1E or touch `main`.

---

### 2026-09-25 20:55 (local) - Phase 0A approved and committed

- Branch: `v2/supabase-migration`
- Commit: `6869e2d` — "Phase 0A: harden ingest empty-checkout init and cover adaptive batching" (not pushed; `main` untouched).
- Contents: `package.json`, `scripts/ingest.py`, `scripts/test_ingest.py`, `scripts/test_push_duckdb_to_supabase.py`, `docs/plans/system-performance-ingest-reliability-remediation.md`, and the Phase 0A/audit entries in this log. Unrelated working-tree changes left unstaged.
- Plan status: Phase 0A completed and owner-approved; Phase 0B not started.
- Open risks or assumptions:
  - This entry is uncommitted (a commit cannot record its own hash); include it with the next commit.
- Next action (single first step):
  - When the owner authorizes Phase 0B, run the ingest-unit diff against `main` listed in the plan's Exact next action.

---

### 2026-09-25 20:45 (local) - Phase 0A review follow-ups

- Branch: `v2/supabase-migration`
- Completed:
  - `package.json`: `check:quick` now also runs `python scripts/test_ingest.py` and `python scripts/test_push_duckdb_to_supabase.py`.
  - Plan top-level status updated to "Phase 0A implemented (uncommitted), awaiting owner approval; Phase 0B not started".
- Validation run:
  - Focused tests: 5/5 and 10/10 pass. `npm run check:quick` passes (includes both scripts).
- Migrations touched:
  - None.
- Open risks or assumptions:
  - Nothing committed or pushed; `main` untouched.
- Next action (single first step):
  - Owner approves 0A; then commit 0A on `v2/supabase-migration` and start Phase 0B with the ingest-unit diff against `main`.

---

### 2026-09-25 20:30 (local) - Phase 0A ingest empty-checkout fix + batching tests

- Preflight sent and accepted:
  - Model: Claude Opus 5.5 (owner-directed phase request)
  - Token-feasibility declared: likely
  - Scope selected: Phase 0A only
- Branch: `v2/supabase-migration`
- Plan doc: `docs/plans/system-performance-ingest-reliability-remediation.md` (Phase 0A results section)
- Scope in this slice:
  - Review retained adaptive batching (`2a209f0`) and `clear_failed_sets()` (`74a4875`), both already committed; neither changed.
  - Harden `get_connection()` to create the DuckDB parent directory.
  - Add regression and batching tests.
- Completed:
  - `scripts/ingest.py`: parent-directory creation in `get_connection()`.
  - `scripts/test_ingest.py`: 5 tests covering a nonexistent path, a table-less file, an older schema missing `failed_sets`, existing rows, and an offline CLI `--clear-failed` run (network patched to fail).
  - `scripts/test_push_duckdb_to_supabase.py`: 10 tests covering repeated shrinkage, the minimum-size floor, a final short batch, exactly-once submission, fatal non-timeout errors, and dry run.
- Validation run:
  - Before: pre-fix `ingest.py` raises `CatalogException: Table with name failed_sets does not exist!`.
  - Focused tests: 5/5 and 10/10 pass. Dry-run push on a fresh fixture: exit 0.
  - `npm run check:quick` (pass)
- Migrations touched:
  - None.
- Open risks or assumptions:
  - Changes are uncommitted pending review. Corrupt/0-byte DuckDB is still fatal by design. Scheduled runs still use `main` code until Phase 0B.
- Next action (single first step):
  - Reviewer reruns `python scripts/test_ingest.py && python scripts/test_push_duckdb_to_supabase.py && npm run check:quick`; if approved, commit 0A and start Phase 0B with the ingest-unit diff against `main` listed in the plan's Exact next action.

---

### 2026-09-25 20:06 (local) - System remediation plan handoff

- Preflight sent and accepted:
  - Model accepted: yes (`GPT-5.6 Sol`)
  - Token-feasibility declared: likely
  - Scope selected: full documentation plan
- Branch: `v2/supabase-migration`
- Plan doc: `docs/plans/system-performance-ingest-reliability-remediation.md`
- Scope in this slice:
  - Convert the read-only performance/ingest/database/deployment audit into a durable phased implementation and review plan.
- Completed:
  - Added verified baseline, guardrails, success criteria, phase dependencies, acceptance gates, validation steps, backout guidance, and reviewer/implementer handoff contract.
  - Prioritized active ingest recovery before performance tuning.
  - Preserved the owner-only `main` policy: ingest-only sync still requires explicit authorization.
- Validation run:
  - Markdown-only change; no new code validation required.
  - Audit baseline before this documentation slice: `npm run check:quick` passed.
- Migrations touched:
  - None.
- Open risks or assumptions:
  - Scheduled Supabase ingest remains broken until Phase 0 is implemented and an approved ingest-only sync reaches the default branch.
  - Existing unrelated working-tree changes must be preserved.
- Next action (single first step):
  - Start Phase 0A on `v2/supabase-migration`: review the existing adaptive batching diff, add an empty-DuckDB `--clear-failed` regression test, fix initialization order, and run `npm run check:quick`; stop for review before any `main` change.

---

### 2026-05-16 — Workbench annotation jump-chip overflow quick fix

- Branch: `v2/supabase-migration`
- Scope in this slice:
  - Quick usability fix for Workbench `AnnotationEditor` sticky section jump chips consuming too much vertical space when they wrap.
- Completed:
  - `src/components/AnnotationEditor.jsx` jump toolbar now stays one row and scrolls horizontally.
- Validation run:
  - `npm run build` (pass)
- Migrations touched: none
- Open risks or assumptions:
  - This is intentionally a quick unblock, not a final navigation design. Revisit later for a more polished responsive section navigator, likely a dropdown or hybrid chips + More menu for narrow Workbench panes.
- Next action (single first step):
  - After current performance work, review Workbench annotation-pane navigation UX and decide whether to replace horizontal scrolling chips with a compact section selector.

---

### 2026-05-13 — tcgdex/ptcgdb dedup + bug fixes (React #31, Keep set & source)

- Preflight sent and accepted: n/a (continued from prior session)
- Branch: `v2/supabase-migration`
- Plan doc: n/a (ad-hoc investigation + fixes)
- Scope in this slice:
  - Investigate "SV4a-005 appears twice" report → surfaced 3,605 real cross-source duplicates (tcgdex ↔ ptcgdb) plus 5,657 false positives (manual cards with bad metadata).
  - Dedup: deleted 3,605 tcgdex copies where ptcgdb counterpart existed (ptcgdb has better rarity coverage: 100% vs 73.3%). Annotations migrated before deletion. 16,100 unique ptcgdb cards preserved.
  - Fix React error #31 in CardDetail More Info tab: `String()` wrappers on `atk.damage`, weakness/resistance `type`/`value`.
  - Fix "Keep set & source" toggle: restore `setIdVal` directly in snapshot restore; useEffect auto-derivation was skipped for source="TCG".
- Completed:
  - Dedup SQL run successfully in Supabase (transaction with annotation migration + DELETE).
  - Bug fixes committed (2ee1b81) and pushed to `v2/supabase-migration`.
  - CLAUDE.md updated with all work.
- Validation run: zero remaining tcgdex/ptcgdb overlaps confirmed via SQL.
- Migrations touched: none (manual SQL, no migration file)
- Open risks or assumptions:
  - `japanese_cards_ptcgdb` table absent from current DuckDB — ptcgdb cards won't re-push, so duplicates won't recur. If ptcgdb ingest is re-enabled, fix the push script to use consistent ID formats or add a dedup step.
  - Manual `pokumon-*` cards have garbage `set_id`/`number` metadata from v1 migration; these aren't duplicates but pollute the `set_id + number` grouping. Consider a cleanup migration to normalize these fields.
  - React #31 fix addresses known object-valued API fields; other raw_data fields could surface similar issues — watch for future reports.
- Next action (single first step):
  - If duplicates reappear after a Japanese card ingest: check whether `japanese_cards_ptcgdb` table was re-created in DuckDB and normalize ID formats in the push script.

---

- Preflight sent and accepted: n/a (documentation request)
- Branch: `v2/supabase-migration` (context applies to v2)
- Plan doc: `docs/plans/supabase-perf-hosting-alternatives-notes.md` (new)
- Scope in this slice:
  - Capture codebase audit findings (Explore `fetchCards`, exact counts, debounced count, prefetch, artist two-step, filter MV path, RLS 057, no Realtime data channels).
  - Capture recommendation order: upgrade tier first; then evidence-led refactor (counts/prefetch/artist); alternative Postgres only for strategic reasons; Appwrite/PocketBase as replatform not hosting swap.
- Completed:
  - Added `docs/plans/supabase-perf-hosting-alternatives-notes.md`.
  - Linked from `CLAUDE.md` under V2 Stack (performance and hosting reference).
- Validation run: n/a (markdown only)
- Migrations touched: none
- Open risks or assumptions:
  - Findings are static; re-validate with Supabase metrics when acting on them.
- Next action (single first step):
  - When revisiting speed: open `docs/plans/supabase-perf-hosting-alternatives-notes.md` § “Next action when revisiting” and profile dominant cost (count vs fetch vs join) before changing code or plan.

### 2026-05-09 — Materialized view for Explore filter options (054)

- Preflight sent and accepted: n/a (continued from prior session)
- Branch: `v2/supabase-migration`
- Plan doc: `docs/plans/v2-bundle-performance-optimization.md`
- Scope in this slice:
  - Materialized view `explore_filter_options` (migration 054) to replace client-paged distinct cascade.
  - CardGrid visual regression fix (revert @tanstack/react-virtual).
  - Vercel deploy fix (remove `_comment` from `vercel.json` rewrites).
  - App adapter 3-tier fallback: materialized view → split-RPC → client-paged.
  - Context docs trimmed (CLAUDE.md: 365→~180 lines; handoff log: 206→~70 lines).
- Completed:
  - `supabase/migrations/054_explore_filter_options_materialized_view.sql` — applied and populated.
  - `src/data/supabase/appAdapter.js` — `fetchExploreFilterOptions()` reads materialized view first (<50ms).
  - `scripts/push_duckdb_to_supabase.py` — calls `refresh_explore_filter_options()` after upserts.
  - `src/components/CardGrid.jsx` — reverted to CSS grid + React.memo + lazy loading.
  - `vercel.json` — removed `_comment` property (Vercel rejects unknown keys).
- Validation:
  - `npm run check:quick` (pass — build 5.05s)
  - Manual QA: owner confirmed filter options load "much faster" on Vercel preview.
- Migrations touched:
  - 053 (applied, opt-in), 054 (applied, default fast path)
- Open risks:
  - Materialized view must be refreshed after ingest. Auto-refreshed in push_duckdb_to_supabase.py.
  - Grid query (fetchCards) still ~8.6s on free tier — needs composite indexes.
  - `public/data/pokemon.duckdb` is 179MB (exceeds GitHub 100MB limit) — not committed.
- Next action:
  - Run `ANALYZE cards` in Supabase SQL Editor, then profile the 8.6s grid query for missing indexes.

---

### 2026-05-02 — TCGdex JP / Pocket image URLs in `ingest.py`

- Branch: `v2/supabase-migration`
- Scope: Japanese + Pocket card rows where TCGdex omits `image` or base path breaks on CDN.
- Completed:
  - `tcgdx_card_high_webp_url(..., japanese_locale=...)` resolves `ja/...` vs `en/...` using cached HEAD.
  - `ingest_japanese_cards` / `ingest_pocket_cards` pass `serie_id` and use this helper.
- Validation: manual `python3 -c` smoke for SM12 vs SV1S synthetic URLs.
- Next action: Re-run Japanese ingest with `--force` then `push_duckdb_to_supabase.py` to backfill image URLs.

### 2026-05-02 — Camera angle multi-select confirmed

- Owner confirmed camera_angle should be multi-select. Migration 044 spec written (not yet implemented at time of entry).
- **Uncommitted changes in working tree** (3 files, 91 lines): First/Last buttons, case-insensitive dedup, `syncReactQueryCardCaches`, debounced form-options invalidation, `staleTime` + `refetchOnWindowFocus` on workbenchCard query. These were Phase 0 — may already be committed in subsequent sessions.
- Next action: Commit Phase 0 changes, then begin Phase 1 (direct cache writes for Workbench nav).
