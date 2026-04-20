# Manual smoke checkbox run

Use this for final release validation on latest **production** and latest **v2 preview**.

If deployment protection is on, run with your Vercel bypass token and revoke it after the pass.

---

## Auth

- [ ] Sign in works on production.
- [ ] Sign out returns to login/protected gate.
- [ ] Refresh keeps signed-in session on a protected route.

## Explore

- [ ] `/` loads grid without visible errors.
- [ ] Search returns results.
- [ ] Filter and reset filters both work.
- [ ] Open card detail works.
- [ ] **Send to Workbench** from card detail works.

## Workbench

- [ ] `/workbench` loads queue and card panel.
- [ ] Edit one field and save succeeds.
- [ ] Move next/previous card works (if queue has more than one card).

## Batch

- [ ] Batch list add from Explore works.
- [ ] `/batch` wizard runs a **trial** pass.
- [ ] Full apply works on a tiny safe set (for example 1-3 cards).
- [ ] **View these edits in history** opens filtered history correctly.

## Data Health

- [ ] `/health` loads both **Manual card ID health** and **Annotation value issues**.
- [ ] **View cards** opens list with thumbnails and load-more behavior.
- [ ] **Copy deep link** works.
- [ ] Cleanup action works on a safe test value and issue counts refresh.

## Public share

- [ ] `/share/card/A1-001` loads in incognito without login.

## Final security cleanup

- [ ] Revoke/burn Vercel bypass token after smoke pass.

---

## Result summary

- [ ] GO (all checks pass)
- [ ] NO-GO (one or more blocking checks failed)

Notes:

- Blocking failures:
- Non-blocking follow-ups:
