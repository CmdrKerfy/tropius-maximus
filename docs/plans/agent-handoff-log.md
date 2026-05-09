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

### 2026-05-02 — TCGdex JP / Pocket image URLs in `ingest.py`

- Preflight sent and accepted: n/a (small ingest fix; no Auto preflight in thread)
- Branch: `v2/supabase-migration`
- Scope: Japanese + Pocket card rows where TCGdex omits `image` or only a base path breaks on CDN.
- Completed:
  - `tcgdx_card_high_webp_url(..., japanese_locale=...)` now resolves `ja/...` vs `en/...` using cached `HEAD` so SM-era JP cards pick working `en/.../high.webp` while SV keeps `ja/...` when that returns 200.
  - `ingest_japanese_cards` / `ingest_pocket_cards` pass `serie_id` from set payload and use this helper instead of `f\"{image_base}/high.webp\"` only.
- Validation run: manual `python3 -c` smoke for SM12 vs SV1S synthetic URLs (not full ingest).
- Next action (single first step):
  - Re-run Japanese ingest with `--force` (or project’s Japanese-only flag) then `push_duckdb_to_supabase.py` so Supabase `image_*` columns backfill for existing JP rows.

### 2026-05-02 — Camera angle multi-select confirmed + Phase 6 added

- Owner confirmed: camera_angle should be multi-select (multiple values per card), not a duplicates issue.
- Updated plan `docs/plans/workbench-performance-save-reliability.md`:
  - Replaced "Deferred — camera angle clarification" with full **Phase 6** implementation spec.
  - Phase 6 covers: migration `044` (TEXT → JSONB[] + backfill + RPC update), 7 app files touched, verification steps, rollback plan.
  - Updated scope summary, files table, and handoff state.
- Camera angle changes touch: `appAdapter.js` (4 constant-set edits), `annotationBridge.js` (insert default), `CardDetail.jsx` (MULTI_VALUE_KEYS + MultiComboBox), `CardDetailFieldControl.jsx` (MultiComboBox), `CustomCardForm.jsx` (array state + MultiComboBox), `seed.sql` (field_type), plus the new migration `044`.
- No code written yet.

---

### 2026-05-02 — Workbench perf + save reliability plan (pre-implementation)

- Preflight sent and accepted:
  - Model accepted: n/a (planning phase only — no code written yet)
  - Token-feasibility declared: n/a (planning)
  - Scope selected: n/a (planning)
- Branch: `v2/supabase-migration`
- Plan doc: `docs/plans/workbench-performance-save-reliability.md`
- Scope in this slice:
  - Analyzed four pieces of user feedback (slowness, save-reliability, camera-angle duplicates, First/Last nav).
  - Reviewed uncommitted working-tree changes from a prior agent (91 lines across 3 files).
  - Wrote 5-phase implementation plan.
- Completed:
  - Full codebase exploration (WorkbenchPage, AnnotationEditor, appAdapter, annotationBridge, save RPC, camera_angle handling).
  - Plan doc written with per-phase file lists, code sketches, and verification steps.
- Validation run:
  - `npm run check:quick` (not run; no code changes in this session)
  - Any manual QA: none
- Migrations touched:
  - None in this session.
- Open risks or assumptions:
  - Phase 3 (`patchAnnotations` return type change) must update ALL callers in one commit — CardDetail, AnnotationEditor, BatchWizard (if it calls patchAnnotations directly).
  - Phase 4 per-card save queue uses an unbounded Map; acceptable for 3 users but worth noting.
  - Camera angle multi-select vs duplicates — deferred pending user clarification.
- **Uncommitted changes in working tree** (3 files, 91 lines): First/Last buttons, case-insensitive dedup, `syncReactQueryCardCaches`, debounced form-options invalidation, `staleTime` + `refetchOnWindowFocus` on workbenchCard query. These are Phase 0 — commit them first.
- Next action (single first step):
  - Run `npm run check:quick` to verify the uncommitted changes pass. Then `git add` the three modified files (`src/pages/WorkbenchPage.jsx`, `src/components/AnnotationEditor.jsx`, `src/data/supabase/appAdapter.js`) and commit them as Phase 0. Then begin Phase 1 (direct cache writes for navigation in `WorkbenchPage.jsx`).

---

## Latest Entries

### 2026-04-23 01:50 (local) - Plan closeout confirmation

- Preflight sent and accepted:
  - Model accepted: yes (Codex 5.3)
  - Token-feasibility declared: likely
  - Scope selected: scoped
- Branch: `v2/supabase-migration`
- Plan doc: `docs/plans/workbench-datahealth-feedback-implementation-plan.md`
- Scope in this slice:
  - Final closeout update after owner-confirmed Phase 8 manual pass.
- Completed:
  - Updated plan status to completed (Phase 1-8 implemented and owner sign-off confirmed).
- Validation run:
  - `npm run check:quick` (not run; docs-only update)
  - Any manual QA: owner confirmed pass prior to closeout update.
- Migrations touched:
  - None.
- Open risks or assumptions:
  - None.
- Next action (single first step):
  - Define a new Phase 9 in this plan or select the next active plan in `docs/plans/`.

### 2026-04-23 01:25 (local) - Phase 8 search normalization

- Preflight sent and accepted:
  - Model accepted: yes (Codex 5.3)
  - Token-feasibility declared: likely
  - Scope selected: full
- Branch: `v2/supabase-migration`
- Plan doc: `docs/plans/workbench-datahealth-feedback-implementation-plan.md`
- Scope in this slice:
  - Phase 8 one-box search normalization.
- Completed:
  - Updated `fetchCards` name search to use one normalized separator-insensitive pattern (`%token%token%`) via `buildNameSearchIlikePattern`.
  - Preserved one search box and existing Explore URL query behavior.
  - Updated active plan status and Phase 8 implementation snapshot.
- Validation run:
  - `npm run check:quick` (pass)
  - Any manual QA: owner confirmed Phase 8 checks pass.
- Migrations touched:
  - None.
- Open risks or assumptions:
  - Token-based wildcard matching may be broader for some short multi-token queries; continue to monitor as new searches are tried.
- Next action (single first step):
  - Run manual Explore parity checks for `Mewtwo EX` vs `Mewtwo-EX` (and similar pairs), then decide whether to tune token wildcard behavior.

### 2026-04-22 (placeholder)

- Branch: `v2/supabase-migration`
- Plan doc: `docs/plans/workbench-datahealth-feedback-implementation-plan.md`
- Scope in this slice:
  - Phase 7 Workbench pins editor parity.
- Completed:
  - Added migration `039_workbench_pins_preferences.sql`.
  - Wired Workbench pin editor and separate `workbench_pins` persistence.
  - Added fallback behavior: Workbench uses `card_detail_pins` until `workbench_pins` is saved.
- Validation run:
  - `npm run check:quick` (pass)
  - Manual QA reported by owner: migration 039 applied and flow confirmed working.
- Migrations touched:
  - `supabase/migrations/039_workbench_pins_preferences.sql` (applied by owner)
- Open risks or assumptions:
  - None currently reported.
- Next action (single first step):
  - Open `docs/plans/workbench-datahealth-feedback-implementation-plan.md` and mark Phase 7 complete before starting Phase 8.
