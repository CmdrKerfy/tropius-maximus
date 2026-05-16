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
