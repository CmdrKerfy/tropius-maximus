# Production hardening — anonymous auth & RLS

**Goal:** Ensure production traffic does not treat **anonymous Supabase sessions** as full app members. Anonymous sign-in was useful for early local testing; on a public URL it must be off or tightly constrained.

---

## 1. Database (defense in depth)

Apply migration **`019_rls_exclude_anonymous_sessions.sql`**:

- Adds `public.auth_is_non_anonymous_authenticated()` (checks JWT `is_anonymous` claim).
- Updates RLS policies on app tables + **`storage.objects`** (avatars) so only **non-anonymous** authenticated users match.

**Unchanged:** `get_public_card_for_share` (**018**) — still **`SECURITY DEFINER`** + **`GRANT ... TO anon`** — public share links work without login.

```bash
# From repo root, if using Supabase CLI linked to the project:
supabase db push
# Or run the SQL file in Supabase → SQL Editor (review first).
```

If a previous **019** attempt failed partway (e.g. wrong policy name), use the **latest** `019` from the repo and re-run the **whole** file in one transaction when possible, or run from the first statement that did not succeed. The function `auth_is_non_anonymous_authenticated` is idempotent (`CREATE OR REPLACE`).

---

## 2. Supabase dashboard

1. **Authentication → Providers → Anonymous** — **turn off** for production (or leave on only if you intentionally need it for a non-app use case).
2. **Authentication → URL configuration** — production + preview URLs remain correct for email/password and magic links.

---

## 3. Vercel environment (Production)

Set explicitly:

| Variable | Production value |
|----------|------------------|
| `VITE_SUPABASE_AUTO_ANON_AUTH` | `false` or **omit** (unset) |

Do **not** rely on “unset means false” without verifying Preview vs Production envs are both correct.

If the team uses **`VITE_REQUIRE_EMAIL_AUTH=true`** (recommended for invite-only), the app already avoids bootstrapping anonymous sessions in `initDB`; the env flag prevents accidental anon sign-in in other code paths.

**Redeploy** after changing env vars.

---

## 4. App behavior (already in code after this work)

- **`RequireAuth`** — only **`isNonAnonymousSession`** counts as signed in when email auth is required.
- **`LoginPage`** — signs out a stale **anonymous** session so users can sign in with a real account.
- **`main.jsx`** — does not prefetch Explore filter options for anonymous sessions when email auth is required.

---

## 5. Local development

- **Without** migration **019**: anonymous JWT still passes old RLS — avoid for security testing.
- **With** **019**: anonymous sessions no longer read `cards` / `annotations` via PostgREST. To develop against real data, use **`VITE_REQUIRE_EMAIL_AUTH=true`** and sign in, **or** temporarily use a branch without **019** (not recommended for shared environments).

---

## Checklist before calling production “done”

- [ ] **019** applied on the Supabase project used by production Vercel.
- [ ] **Anonymous** provider disabled (or explicitly justified + monitored).
- [ ] **`VITE_SUPABASE_AUTO_ANON_AUTH`** not enabled in production Vercel env.
- [ ] **`VITE_REQUIRE_EMAIL_AUTH=true`** in production if everyone uses invite/email sign-in.
- [ ] Smoke test: signed-in user can Explore; **incognito** without login can open **`/share/card/...`** only (not Explore).

---

*See also `CLAUDE.md` → Before finishing the v2 plan (production checklist).*
