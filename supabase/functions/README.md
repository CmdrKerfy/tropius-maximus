# Supabase Edge Functions

## `request-magic-link`

Gated magic-link requests:

1. Caller sends **invite code** (matches `INVITE_SECRET`) and **email**.
2. Email must exist in `signup_allowlist` (migration `012_signup_allowlist.sql`).

### One-time setup

1. Run migration **`012`** in the Supabase SQL editor (or `supabase db push`).
2. Add allowed emails:

   ```sql
   INSERT INTO signup_allowlist (email, note) VALUES
     ('you@example.com', 'owner'),
     ('teammate@example.com', 'editor');
   ```

3. **Dashboard → Project Settings → Authentication → URL configuration**  
   Add your site URL and redirect:  
   `https://YOUR_VERCEL_APP.vercel.app/auth/callback`  
   (and `http://localhost:5173/auth/callback` for local dev.)

4. **Edge Function secrets** (Dashboard → Edge Functions → **Secrets**, or CLI):

   ```bash
   supabase secrets set INVITE_SECRET="your-long-shared-passphrase"
   supabase secrets set SITE_URL="https://YOUR_VERCEL_APP.vercel.app"
   ```

5. Deploy:

   ```bash
   supabase functions deploy request-magic-link --no-verify-jwt
   ```

   Or use the Dashboard **Deploy** flow; ensure **`verify_jwt` is off** for this function (see `supabase/config.toml`).

6. **App env (Vercel + `.env.local`):**

   ```bash
   VITE_REQUIRE_EMAIL_AUTH=true
   ```

   Turn **`VITE_SUPABASE_AUTO_ANON_AUTH`** **off** in production. Disable **Anonymous** sign-in in Supabase when everyone uses email.

### Why not “just a code” in the frontend?

A secret typed only in the browser can be extracted from the built JS bundle. The **invite code is checked in this function**, together with the **allowlist**, so both stay server-side (except the code the user types, which is fine).
