# Production readiness final pass (v2)

Goal: close all remaining launch blockers and high-value polish before owner-approved cutover.

This plan covers:

- Must-do before production
- Strongly recommended polish
- Nice-to-have UX consistency items

---

## Phase 1 - Environment and migration parity (blocking)

### 1.1 Verify migration parity on staging and production

- [ ] Confirm both projects have all required migrations through `028`:
  - `025b_manual_card_dedupe_preflight_rpc.sql`
  - `026_manual_card_id_cleanup.sql`
  - `027_manual_card_id_health_check.sql`
  - `028_annotation_value_issues_and_cleanup_rpc.sql`
- [ ] Capture migration status evidence (SQL editor output or `supabase migration list` screenshot/log).
- [ ] Re-run app smoke on both projects after migration sync.

Acceptance criteria:

- No missing-function errors for RPCs used by Data Health and SQL preflight.
- Staging and production schema are functionally identical for v2 app paths.

---

### 1.2 Production hardening (anon auth + RLS)

Follow `docs/plans/production-hardening-anon-auth.md`.

- [ ] Apply `019_rls_exclude_anonymous_sessions.sql` on production Supabase project.
- [ ] Disable Anonymous provider in Supabase Auth settings (production).
- [ ] Verify Vercel production env:
  - [ ] `VITE_SUPABASE_AUTO_ANON_AUTH` unset or `false`
  - [ ] `VITE_REQUIRE_EMAIL_AUTH=true` (invite-only mode)
  - [ ] Supabase URL + anon key present and correct
- [ ] Redeploy production after env updates.

Acceptance criteria:

- Signed-in member can access app routes.
- Incognito (not logged in) cannot access protected app routes.
- Public card share route still works anonymously.

---

### 1.3 Full Vercel smoke pass

Follow `docs/plans/e2e-vercel-smoke-checklist.md` end-to-end.

- [ ] Run full checklist on staging preview URL.
- [ ] Run full checklist on production URL.
- [ ] Log any regressions and block launch if critical paths fail.

Acceptance criteria:

- Auth, Explore, Workbench, Batch, History, Dashboard/Profile, Data Health, and share links all pass.

---

## Phase 2 - Strongly recommended polish (high value)

### 2.1 Data Health graceful RPC fallback UI

- [x] Handle missing Data Health RPCs with explicit migration guidance (instead of raw function-cache errors).
  - `get_manual_card_id_health_issues` -> migration `027`
  - `get_annotation_value_issues` / `get_cards_for_annotation_value_issue` / `apply_annotation_value_cleanup` -> migration `028`

Acceptance criteria:

- Users see clear, actionable fallback text naming missing function + migration file.
- Core Data Health page still renders when a non-critical RPC is missing.

---

### 2.2 Session-level undo affordance/log for cleanup actions

- [x] Add “last cleanup in this session” note for replace/remove actions.
- [x] Provide “Prepare undo (replace back)” helper for replace-mode cleanup.
- [ ] Optional follow-up: persist a short cleanup event log in `sessionStorage` so refreshes keep context.

Acceptance criteria:

- User can quickly stage a reverse replace without manually retyping values.
- UI clearly states remove-mode cannot be perfectly auto-restored.

---

### 2.3 Cap heavy “View cards” rendering

- [x] Limit initially visible cards in Data Health selected-issue table.
- [x] Add “Load more” paging increment for large result sets.

Acceptance criteria:

- Large issue sets do not render all rows at once.
- User can progressively reveal rows without losing current selection state.

---

### 2.4 Quick deep-link copy for teammate triage

- [x] Add “Copy deep link” action for selected issue (`field=value` Explore link).
- [ ] Optional follow-up: add copied-state microfeedback on the button itself (temporary “Copied” label).

Acceptance criteria:

- One click copies an absolute Explore URL suitable for teammate handoff.

---

## Phase 3 - Nice-to-have UX finishing

### 3.1 Hover-preview loading skeleton

- [x] Add lightweight skeleton placeholder while preview image loads.

### 3.2 Cleanup mode helper copy

- [x] Add one-line explanatory text under cleanup mode selector.

### 3.3 Color semantics consistency

- [x] Keep warning sections amber.
- [x] Keep triage sections slate/blue.
- [x] Keep destructive actions red (clear selection + apply cleanup).

Acceptance criteria:

- Color intent is visually consistent and predictable across Data Health actions.

---

## Verification checklist before owner go/no-go

- [ ] Confirm all Phase 1 items complete (blocking).
- [ ] Validate Data Health end-to-end on production project:
  - [ ] Manual ID health loads
  - [ ] Annotation value issues load
  - [ ] View cards works
  - [ ] Cleanup runs successfully and refreshes issue counts
- [ ] Run `npm run check:quick` locally.
- [ ] Run `npm run check` (includes Playwright) if time permits.
- [ ] Re-test Explore/CardDetail filter interactions for regressions after Data Health updates.

---

## Rollout order

1. Staging migrations + staging smoke
2. Production migrations + auth hardening + production redeploy
3. Production smoke pass
4. Owner go/no-go decision for cutover

Note: merge/cutover to `main` still requires explicit owner approval in conversation.
