# Manual smoke checklist — Vercel + Supabase (v2)

**When to run:** Treat this checklist as the **final verification** immediately **before** you merge or cut over (after migrations are applied on the target Supabase project and Vercel env matches). Earlier deploy testing is fine, but don’t skip this pass at the end.

**Before this checklist:** complete infra steps in **`docs/plans/p1-cutover-and-operations.md`** (§1 Vercel env + “Pre-merge: Supabase migrations + production policy”).

Use after **preview** or **production** deploys when you’re validating a release. **Local automation:** see **`docs/site-checks.md`** — run **`npm run check:quick`** often; run **`npm run check`** (adds Playwright) when you have time. Neither replaces this Vercel + real Supabase list.

**URLs:** Record your Vercel preview/production base URL(s) here when testing.

| Environment | Base URL |
|-------------|----------|
| Production | | tropius-maximus-htumntgv5-cmdrkerfys-projects.vercel.app
| Preview | | tropius-maximus-9f3070850-cmdrkerfys-projects.vercel.app

---

## Auth

- [x] **Sign in** works (`/login` or your configured entry) when `VITE_REQUIRE_EMAIL_AUTH` is on.
- [x] **Sign out** clears session; protected routes redirect or prompt login as expected.
- [x] **Auth callback** (`/auth/callback`) completes without error for your auth method (password / magic link as configured).
- [x] **Session persists** across refresh on a normal page (e.g. Explore).

---

## Explore

- [x] **`/`** loads grid without console errors.
- [x] **Search / filters** return results; clear filters restores list.
- [x] **Open card detail** — image and fields load.
- [x] **Send to Workbench** (if used) adds card to queue without error.

### Explore performance (Phases 1–6)

After deploys that touch **`main.jsx`**, **`appAdapter.js`**, or migrations **020**–**023**, run the **Network / timing / RLS** table in **`docs/plans/explore-supabase-performance.md`** (Phase 6). Emergency RPC bypass: **`VITE_USE_FILTER_OPTIONS_RPC=false`** (see **`.env.example`**).

---

## Workbench

- [ ] **`/workbench`** loads queue and card pane.
- [ ] **Save annotation** succeeds; no silent failure (toast or inline feedback).
- [ ] **Navigate queue** (if multiple cards) works.
- [ ] **About Workbench** (`WorkflowModeHelp`) expands; copy mentions Send to Workbench vs Explore vs Batch.

---

## Batch (saved list + wizard — see **`docs/plans/batch-redesign-visual-selection.md`**)

- [ ] **Explore:** expand **Batch tools** (or have cards in list); grid shows batch checkboxes; **Clear batch list** styling is visible.
- [ ] **Explore:** **Add all matching** / **Add list to Workbench** / **Open Batch** behave as expected (cap warning if > max cards).
- [ ] **`/batch`** with a non-empty list: **BatchWizard** — field(s) → review → confirm → apply; optional **trial run** (first 3/5/10 cards); **View these edits in history** opens **`/history`** with `since`, `mine=1`, and **`run=`** (batch id) when **`025`** is applied (or `field=` for single-field runs). **History** flat list filters sync to the URL (`card`, `field`, `since`, `run`, `mine`).
- [ ] After **`024_batch_selections`**: sign in on two browsers — batch list changes sync (debounced); anonymous / unsigned stays local-only.
- [ ] After **`025_batch_runs_edit_history`**: **History → Batch runs** tab lists runs; **View rows** expands; **`edit_history`** rows show **Batch run** links in flat list; multi-field batch creates one run with comma-separated field names.
- [ ] Partial failure: error list shows **grouped** reasons + per-card **hint** line; **Retry failed only** / **Copy failed IDs** work.
- [ ] Post-run: **Clear batch list** vs **Keep list — new field**; optional **curated options** per custom select step (if applicable).

**Backlog status:** **`docs/plans/batch-future-enhancements.md`** (items 3–7 addressed in app + migrations **`024`** / **`025`**).

---

## Other app routes (spot-check)

- [x] **`/health`** — loads (even if empty).
- [x] **`/fields`**, **`/batch`**, **`/history`** — open without crash (permissions as designed).
- [x] **`/dashboard`** / **`/profile`** — match your auth expectations.

---

## Public share (no login)

- [x] **`/share/card/{validCardId}`** — read-only card view; image or placeholder.
- [x] **Invalid id** — friendly not found.
- [x] **Copy share link** from Card detail (signed in) — URL opens in incognito.

---

## Link previews (optional)

- [x] Paste share URL in **iMessage** or **WhatsApp** (self-chat) — thumbnail/title reasonable.

---

## Supabase / env sanity

- [x] **Production env** on Vercel: `VITE_USE_SUPABASE`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` present; redeploy after changes.
- [x] **Supabase Auth** redirect URLs include your Vercel host(s) if using hosted auth flows.

---

## Production checklist (before public launch)

Follow **`docs/plans/production-hardening-anon-auth.md`** (migration **019**, Supabase Anonymous provider, Vercel env).

---

*Add rows as your flows grow; replace with automated E2E when introduced.*
