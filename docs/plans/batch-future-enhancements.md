# Batch — future enhancements (backlog)

**Purpose:** Track optional follow-ups after **`batch-redesign-visual-selection.md`** shipped. Not scheduled; revisit when pain or capacity appears.

**Related:** **`docs/plans/batch-redesign-visual-selection.md`** (complete), **`docs/plans/e2e-vercel-smoke-checklist.md`** (manual QA). **Workbench-only items** also land here as a single backlog file (see row **8**).

---

## Backlog (prioritized loosely)

| # | Enhancement | Why | Trigger to revisit |
|---|-------------|-----|---------------------|
| 1 | **Server-backed batch list** (`batch_selections` in Supabase) | Survives device/browser | **Shipped:** migration **`024_batch_selections.sql`** + `fetchBatchSelection` / `upsertBatchSelection`; `useBatchSelection` sync (debounced). Anonymous sessions stay localStorage-only. |
| 2 | **History deep-link after batch** (time window or field filter) | Faster audit than scrolling | **Shipped:** `/history?since=&field=&mine=1` + `fetchEditHistory` filters; Batch “View these edits in history” builds the query string. |
| 3 | **Dry-run / validate sample** before full apply | Reduces fear on huge lists | **Partial:** Step 3 **Trial run** (first 3 / 5 / 10 cards) in **`BatchWizard`**. |
| 4 | **Automated E2E** (Playwright) for Explore + Batch paths | Regression safety pre-cutover | **Shipped:** `@playwright/test`, **`playwright.config.mjs`**, **`tests/e2e/smoke.spec.js`** (DuckDB + no auth). Run `npm run test:e2e:install` once, then `npm run test:e2e` (starts preview on port **5174**). |
| 5 | **Richer error UX** (beyond buckets) | Copy suggested fixes per error code | **Shipped:** **`src/lib/batchErrorHints.js`** + hints under each failed card in **`BatchWizard`**. |
| 6 | **Edit history: “batch run” grouping** | One row per run, expand to cards | **Shipped:** migration **`025_batch_runs_edit_history.sql`**, **`batch_runs`** + **`edit_history.batch_run_id`**, History **Batch runs** tab + **`run=`** URL filter; RPC **`p_batch_run_id`**. |
| 7 | **Multi-field batch** | Power feature; large scope (review, confirm, rollback story) | **Shipped:** up to **`MAX_FIELD_STEPS` (5)** in **`BatchWizard`** + **`BatchFieldStepBlock`**; merged patch per card. |
| 8 | **Workbench: keyboard prev/next on queue** | Today only **Previous / Next** buttons update `current_index` (`WorkbenchPage.jsx`). **Explore → card detail** already supports **← / →** between grid cards (`CardDetail.jsx`). Binding the same affordance on Workbench (plain arrows vs **Ctrl/Cmd + arrows** when focus is in inputs—TBD) speeds sequential passes without the mouse. | Workbench keyboard / polish milestone; after onboarding feedback; **mirror:** **`docs/plans/ui-refresh-modern-ux.md`** Phase 5 unchecked item |

---

## Implemented from this list (for reference)

- **(1)** Server-backed list — apply **`024_batch_selections.sql`** on each Supabase project used with v2.
- **(2)** History filters + batch link — **`EditHistoryPage`** reads `card`, `field`, `since`, `run`, `mine` from the URL; **`BatchWizard`** passes `since`, **`run`** (batch id when available), optional `field` for single-field runs, and **`mine=1`**.
- **(3–7)** See table rows above; apply **`025`** on Supabase for batch runs + stamped **`edit_history`** rows.
- **(5) partial:** **`batchErrorBuckets.js`** (group headers) + **`batchErrorHints.js`** (per-card hint line).

---

## Explicit non-goals (unchanged)

- Cross-field batch in one run without a full new spec
- Replacing Workbench or card-detail editing for one-offs
