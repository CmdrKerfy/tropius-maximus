# Cross-functional panel review (pre-launch baseline)

Purpose: preserve specialist findings from the latest multi-role review and enforce periodic re-review after major changes.

---

## Review cadence reminder (operational)

Run this panel review:

- After any **major feature** (new route, new write path, new auth flow, new migration family).
- After any **security-sensitive change** (auth/session, edge functions, RLS, public share/middleware).
- After any **data integrity operation** (bulk cleanup, dedupe, normalization, backfill).
- Before any **go-live/cutover** decision.

Suggested rhythm:

- Lightweight pass every **2-4 weeks** during active development.
- Mandatory deep pass at each release-candidate checkpoint.

Owner reminder prompt for agents:

> “Cross-functional panel review is due after this milestone. Should we run the security/data/ops/QA panel check before continuing?”

---

## Specialist findings snapshot

### 1) Application security

Status:

- Edge auth functions are intentionally unauthenticated (`verify_jwt=false`) but need stronger abuse controls.

Concerns:

- Brute-force / probing risk on invite endpoints.
- Error response granularity can reveal whether invite code or allowlist check failed.

Recommendations:

- Add per-IP + per-email rate limiting.
- Return generic auth failure copy for invite endpoints.
- Add bot friction (Turnstile/hCaptcha) for auth entrypoints.
- Rotate `INVITE_SECRET` on a schedule.

### 2) Identity/Auth engineering

Status:

- Invite/password architecture is workable.

Concerns:

- `invite-set-password` scans user pages to find an email (`listUsers` loop), which does not scale well.

Recommendations:

- Replace paged scan with deterministic lookup strategy.
- Keep auth anti-automation controls aligned with security recommendations.

### 3) Database administration

Status:

- Migration strategy is strong; `029` fixed cleanup RPC runtime issue.

Concerns:

- Non-standard migration naming (`025b`) is skipped by Supabase CLI history matching.

Recommendations:

- Keep explicit function-presence verification for `025b`.
- Prefer standard migration numbering for future files.

### 4) Data governance/auditability

Status:

- Cleanup tooling is functional.

Concerns:

- Bulk Data Health cleanup updates annotations without row-level edit history equivalent to normal annotation edit flows.

Recommendations:

- Add bulk operation audit trail (`edit_history` or dedicated `bulk_edit_history` table/run log).

### 5) QA/test automation

Status:

- `check:quick` gate is stable.

Concerns:

- Browser E2E path is not currently a dependable required gate in local/CI workflows.

Recommendations:

- Keep manual Vercel smoke checklist as release gate until E2E stabilizes.
- Add CI browser smoke once runner reliability is fixed.

### 6) Frontend performance

Status:

- UX improvements are strong.

Concerns:

- Supabase path still carries legacy DuckDB code weight in shared runtime paths.

Recommendations:

- Further split/lazy-load DuckDB adapter from Supabase runtime.

### 7) DevOps / release operations

Status:

- Good branch/deploy discipline and runbook usage.

Concerns:

- Production parity can drift if migration history metadata and runtime schema differ.

Recommendations:

- Keep explicit parity checks (`migration list`, RPC health checks, smoke checklist) before release.

---

## Immediate action queue (recommended)

- Auth edge endpoint abuse hardening (rate limits + generic errors).
- Real-value Data Health cleanup audit story.
- Complete and log full manual smoke pass (`docs/plans/manual-smoke-checkbox-run.md`).
- DuckDB/Supabase bundle boundary optimization for faster Supabase-mode startup.

---

## Track as future enhancements

- Deterministic local browser smoke runner (or stable Playwright pipeline) + CI browser job.
- Invite auth user lookup scalability improvements.
- Standardize non-numeric migration naming strategy (follow-up for `025b` style exceptions).
- OG/canonical URL hardening to prefer trusted configured origin over request host headers.
- Continue periodic parity hygiene checks (`migration list` + RPC presence checks) as operational routine.
