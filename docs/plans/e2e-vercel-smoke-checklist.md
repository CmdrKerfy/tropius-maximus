# Manual smoke checklist — Vercel + Supabase (v2)

Use after **preview** or **production** deploys, or before calling cutover “good enough.”  
**Automated E2E** (Playwright, etc.) is not in-repo yet; this is the stand-in.

**URLs:** Record your Vercel preview/production base URL(s) here when testing.

| Environment | Base URL |
|-------------|----------|
| Production | |
| Preview | |

---

## Auth

- [ ] **Sign in** works (`/login` or your configured entry) when `VITE_REQUIRE_EMAIL_AUTH` is on.
- [ ] **Sign out** clears session; protected routes redirect or prompt login as expected.
- [ ] **Auth callback** (`/auth/callback`) completes without error for your auth method (password / magic link as configured).
- [ ] **Session persists** across refresh on a normal page (e.g. Explore).

---

## Explore

- [ ] **`/`** loads grid without console errors.
- [ ] **Search / filters** return results; clear filters restores list.
- [ ] **Open card detail** — image and fields load.
- [ ] **Send to Workbench** (if used) adds card to queue without error.

---

## Workbench

- [ ] **`/workbench`** loads queue and card pane.
- [ ] **Save annotation** succeeds; no silent failure (toast or inline feedback).
- [ ] **Navigate queue** (if multiple cards) works.

---

## Other app routes (spot-check)

- [ ] **`/health`** — loads (even if empty).
- [ ] **`/fields`**, **`/batch`**, **`/history`** — open without crash (permissions as designed).
- [ ] **`/dashboard`** / **`/profile`** — match your auth expectations.

---

## Public share (no login)

- [ ] **`/share/card/{validCardId}`** — read-only card view; image or placeholder.
- [ ] **Invalid id** — friendly not found.
- [ ] **Copy share link** from Card detail (signed in) — URL opens in incognito.

---

## Link previews (optional)

- [ ] Paste share URL in **iMessage** or **WhatsApp** (self-chat) — thumbnail/title reasonable.

---

## Supabase / env sanity

- [ ] **Production env** on Vercel: `VITE_USE_SUPABASE`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` present; redeploy after changes.
- [ ] **Supabase Auth** redirect URLs include your Vercel host(s) if using hosted auth flows.

---

## Production checklist (before public launch)

Re-read **`CLAUDE.md` → Before finishing the v2 plan (production checklist)** — anonymous sign-in, RLS, `VITE_SUPABASE_AUTO_ANON_AUTH`.

---

*Add rows as your flows grow; replace with automated E2E when introduced.*
