# Phase 2B/2D: card-write restrictions and server-authoritative audit

**Status (2026-09-27):** groundwork, security review, and pre-apply production baseline done; **nothing applied**. The owner approved Option A (any signed-in collaborator may rename/delete any manual card). Reviewed SQL is now in timestamped migration files. Waiting on owner approval for each production apply step below.

Parent plan: `system-performance-ingest-reliability-remediation.md` (sections 2B, 2D).

## Files

| File | What |
|---|---|
| `supabase/migrations/20260927225104_restrict_card_writes.sql` | 2B migration (approved Option A), verify queries, rollback |
| `supabase/migrations/20260927225105_server_authoritative_audit.sql` | 2D migration, verify queries, rollback |
| `supabase/tests/fixtures/prod_shape_write_authz.sql` | Production-shaped fixture (catalogs read 2026-09-27) |
| `supabase/tests/write_authz_lib.sql`, `write_authz.test.sql` | 44 JWT-identity probes, each rolled back |
| `supabase/tests/run_write_authz_tests.sh` | Throwaway Postgres: before → 2B → 2D → after; second DB 2D → 2B → after |
| `supabase/tests/prod_rollback_probes_write_authz.sql` | 10 probes against real production policies; always rolls back; **run only with owner approval** |

The SQL remained in `supabase/drafts/` until the owner decision, security review, and production baseline were complete. It was promoted to the timestamped migration files above only after explicit owner approval. Do not use `supabase db push`; production apply remains manual and separately approval-gated.

## Production inventory (read-only, 2026-09-27 ~22:40 UTC)

**Data:** cards 59,226 total: manual 12,041, pokemontcg.io 20,670, ptcgdb 19,705, tcgdex 6,810. Only **226 manual cards have `created_by`**, all from one account. The other **11,815 have NULL `created_by`** (migrated from v1). auth.users: 4 (2 anonymous). Annotations: 1,126 (796 on pokemontcg.io cards, 329 manual, 1 tcgdex), versions 1–21, none NULL. edit_history: 518 rows, none with NULL `edited_by`. 295 rows carry a batch run, and every one matches its run's owner. No triggers on cards, sets, annotations, edit_history or batch_runs.

**Policies today:**

| Table | Policy | Effect |
|---|---|---|
| cards | SELECT `TO authenticated USING (true)` | fine (catalog) |
| cards | INSERT / UPDATE / DELETE: `auth_is_non_anonymous_authenticated()` only | **any collaborator can insert, PATCH or DELETE any card, including 47,185 API cards** |
| sets | INSERT / UPDATE: same check; no DELETE policy | **any collaborator can rename API sets or insert "API" sets** |
| annotations | FOR ALL, inline non-anonymous check | direct PATCH/DELETE of any annotation, with any audit values and no history |
| edit_history | INSERT: non-anonymous only | direct insert with forged `edited_by`, `edited_at`, `batch_run_id` |
| batch_runs | INSERT/SELECT own | fine |

**Grants:** anon and authenticated hold every privilege on cards, sets, annotations, edit_history, batch_runs and batch_selections, **including TRUNCATE**. RLS does not cover TRUNCATE, but PostgREST cannot issue it, so this is hygiene rather than an open hole. service_role and postgres have BYPASSRLS.

**RPCs that write:**
- `apply_annotation_with_history` (INVOKER): copies `version`, `updated_by` and `updated_at` from the client's `p_row`. `p_batch_run_id` is only FK-checked.
- `rename_manual_card_with_history` (INVOKER): manual-only guard; needs the cards UPDATE policy.
- `apply_annotation_value_cleanup` (INVOKER, Data Health): already derives version + 1, `now()` and `auth.uid()`. It writes no history (the existing "Data Health cleanup audit trail" item).
- `ensure_set_exists` (INVOKER, any origin): the app never calls it.

**App write paths** (`src/data/supabase/appAdapter.js`):
- `addTcgCard` / `addPocketCard`: INSERT a card (`origin 'manual'`, `created_by` = self), `ensureManualSetRow` INSERTs a manual set (23505 ignored), then a direct annotation INSERT (version 1). If the annotation insert fails, the card is deleted again.
- `deleteCardsById`: direct DELETE. The manual-only check runs **client-side only**.
- `renameManualCard`: the RPC.
- `patchAnnotationsImpl`: the RPC, sending `version` = read + 1, `updated_by` = self and `updated_at` = the browser clock. Batch passes `batchRunId`.
- Nothing updates API cards or sets directly. API-card edits go through `annotations.overrides`.
- Ingest (`push_duckdb_to_supabase.py`) and `migrate_data.py` use the service key.
- Public share (`get_public_card_for_share`) is SECURITY DEFINER, owned by postgres.

## Design

### 2B: restrict card and set writes

- **cards:**
  - authenticated keeps SELECT, INSERT and DELETE; UPDATE is revoked.
  - INSERT policy: `origin = 'manual' AND created_by = auth.uid() AND api_hash IS NULL AND last_seen_in_api IS NULL`.
  - DELETE policy: `origin = 'manual' AND can_manage_manual_card(created_by)`. An API-card delete now affects 0 rows.
  - The UPDATE policy is dropped. Renames go only through `rename_manual_card_with_history`, which becomes **SECURITY DEFINER** with `search_path ''` and keeps its guards and error texts. It adds the owner-decision check and always writes history. EXECUTE is revoked from PUBLIC and anon.
- **sets:** INSERT only `origin = 'manual'`. UPDATE and DELETE are revoked and the UPDATE policy is dropped.
- **anon:** no write privileges on cards or sets.
- **Unaffected:**
  - service_role ingest (BYPASSRLS plus grants kept);
  - public share (a DEFINER RPC; its grants are unchanged);
  - Explore reads (the SELECT policy is unchanged).
- **The owner decision lives in one function**, `public.can_manage_manual_card(created_by)`, so changing the answer later touches one place.

### 2D: server-authoritative audit

- **BEFORE INSERT OR UPDATE trigger on annotations** (`annotations_enforce_server_audit`):
  - It applies only when `auth.role() = 'authenticated'`, so it covers the RPC, direct PostgREST writes and the cleanup RPC.
  - It sets `updated_by = auth.uid()` and `updated_at = now()`.
  - An INSERT must be version 1. An UPDATE must be exactly old + 1. `card_id` cannot change.
  - service_role and direct SQL keep explicit values (migration scripts).
- **`apply_annotation_with_history`:**
  - requires a signed-in, non-anonymous caller;
  - rejects a batch run the caller does not own (`BATCH_RUN_NOT_OWNED`, 42501);
  - requires `p_expected_version` on update;
  - rejects `p_row.version` ≠ expected + 1 (insert: ≠ 1) with `ANNOTATION_VERSION_INVALID` (22023);
  - writes `version = t.version + 1`, `updated_by = auth.uid()` and `updated_at = now()` itself.
  - **The optimistic lock is unchanged**: `WHERE t.version = p_expected_version`, plus the P0001 `ANNOTATION_VERSION_CONFLICT`.
  - New errors never use P0001, because the client treats P0001 as a conflict and retries it 6 times.
- **edit_history INSERT policy:** `edited_by = auth.uid() AND edited_at = now() AND (batch_run_id IS NULL OR the caller owns it)`. `now()` is the transaction timestamp, which is also the column default.
- **Grants:**
  - annotations: authenticated loses DELETE and TRUNCATE (unused). Card deletes still cascade (test 2D-21).
  - edit_history and batch_runs: authenticated loses UPDATE, DELETE and TRUNCATE.
  - anon loses all writes.
- **No client change is needed**: honest clients already send read + 1 and their own uid. As a bonus, browser clock skew no longer reaches `updated_at`.

## Owner decision (2B)

Who may **rename or delete manual (custom) cards**?

- **A. Any signed-in collaborator, for any manual card — approved by the owner 2026-09-27.** This is the drafted behavior and matches today's behavior for manual cards.
- **C. Only the card's creator.** 11,815 of 12,041 manual cards have no creator (migrated from v1), so nobody could rename or delete those from the app. It also needs a client fix: `deleteCardsById` would report a blocked delete as done (0 rows, no error). Use `.select('id')` and check the length.
- **B. Creator, or an app admin.** Needs an admin list (a small table or profile flag), with a backfill or admin-only handling for the NULL-creator cards. This is a separate small slice.

Adding cards is unaffected by the choice: anyone signed in can add, credited to themselves.

## Test results

**Local** (`supabase/tests/run_write_authz_tests.sh`, Postgres 18.x; production is 17.6): **132/132 pass**. That is 44 probes × 3 phases: before; after 2B → 2D; after 2D → 2B.

- **Before:** every hole is reproduced. API card PATCH, DELETE (annotation cascaded) and INSERT; manual cards credited to others; API set rename; forged `updated_by`/`updated_at`; version jumped to 99 or decreased to 1; another user's batch run; forged or backdated history; direct annotation delete; TRUNCATE.
- **After** (both orders), the same attacks are rejected with 42501, 22023 or 0 rows. These still work:
  - app Add Card (card, set, annotation insert) and manual delete (own, other's and legacy under Option A), with the delete still cascading its annotation;
  - rename via the RPC, with a history row by the caller;
  - annotation save, Batch save with the caller's own run, and the P0001 stale-version conflict;
  - Data Health cleanup, crediting the caller;
  - service_role update, upsert and delete of API cards and sets, including explicit audit values.

**Production probe script** (`prod_rollback_probes_write_authz.sql`): validated on the fixture. **Pre-apply production baseline run once with owner approval on 2026-09-27:** P1–P9 all `ok` (holes open), and P10 returned the expected `P0001 ANNOTATION_VERSION_CONFLICT`. The command exited 1 because the script's final deliberate exception aborted the transaction and carried the results. A separate read-only verification found 0 probe cards, 0 probe history rows, no probe suffix on the target card or set, and target `base1-1` still had its annotation at version 1. No probe write persisted.

## Security review

**Completed 2026-09-27; no high or critical findings in the reviewed SQL.** The review found it production-ready for the invite-only shared-collaborator authorization model and confirmed the application write paths remain compatible.

Two medium residual audit-integrity gaps remain and are follow-up work, not blockers to the 2B/2D authorization gate:

1. Authenticated callers retain direct `annotations` UPDATE, so a direct PostgREST PATCH gets server-derived identity/version fields but writes no `edit_history`.
2. `field_name`, `old_value`, and `new_value` remain client-computed; the caller can submit history content that does not match the row diff. Direct honest-attribution history inserts also remain allowed.

Possible follow-up: server-compute the annotation diff, revoke direct authenticated annotation UPDATE and edit-history INSERT, and route cleanup/add-card paths through appropriately narrow RPCs.

## Application sequence (each step needs explicit owner approval)

1. **Done 2026-09-27:** owner picked A; security/data-integrity review found no high/critical blocker and recorded the two medium audit-completeness follow-ups above.
2. **Done 2026-09-27 with owner approval:** ran `prod_rollback_probes_write_authz.sql` once on production. P1–P9 were `ok`, P10 was `P0001`, and the separate rollback verification above passed.
3. Move the reviewed SQL to timestamped migrations. Commit, then push v2 (no frontend change, so the Vercel deploy is a no-op for behaviour).
4. **Apply 2B** as SQL via the Supabase MCP tool. Run the verify queries in the file header and re-run the probe script (expect P1–P5 rejected). Owner in the app:
   - Add Card on a test custom card, then rename it, then delete it;
   - open a share link while signed out;
   - check Explore.
5. **Apply 2D** the same way. Re-run the probes (expect P6 22023, P7 credits the caller, P8/P9 42501, P10 P0001). Owner:
   - edits one field in Card Detail and one in Workbench;
   - runs one small Batch (History shows the run under their name);
   - runs one Data Health cleanup, or skips it;
   - checks that a two-tab edit of the same card still shows the "updated elsewhere" message.
6. Update this doc, the remediation plan and the handoff log.

If a step fails, run the rollback block at the end of that migration. Both migrations are single transactions.

## Residual risks and follow-ups (not in these drafts)

- **History content is still client-computed** (`field_name`, `old_value`, `new_value` from `buildEditHistoryPayload`). Who and when are now server-derived; what is not. A server-side diff of OLD vs NEW inside the RPC would close this and is a separate slice.
- **Manual card deletes write no history.** The annotation cascades and the audit trail loses the card. Option: a `delete_manual_cards` RPC that records `card_deleted`.
- **The Data Health cleanup RPC writes no history** (existing pending item).
- `batch_runs.field_name` and `card_count` are client-set (cosmetic).
- `rename_manual_card_with_history` becomes a new SECURITY DEFINER function. It is narrow, has `search_path ''` and no anon EXECUTE. Include it in the 2C inventory.
- The fixture is hand-built from production catalogs, so the probes on real production (steps 2, 4 and 5) are the authoritative check.
- The Workbench concurrent-move test (2A leftover) is not covered here.
