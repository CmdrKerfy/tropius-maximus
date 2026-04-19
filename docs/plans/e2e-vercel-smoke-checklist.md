# Manual smoke checklist — Vercel + Supabase (v2)

Use after **preview** or **production** deploys, or before calling cutover “good enough.”  
**Automated E2E** (Playwright, etc.) is not in-repo yet; this is the stand-in.

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
