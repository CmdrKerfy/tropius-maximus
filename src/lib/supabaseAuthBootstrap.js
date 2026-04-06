import { getSupabase } from "./supabaseClient.js";

/**
 * Ensures a Supabase session exists so RLS policies (authenticated) allow reads/writes.
 * When VITE_SUPABASE_AUTO_ANON_AUTH=true, signs in anonymously if needed.
 * Enable "Anonymous sign-ins" in Supabase → Authentication → Providers.
 */
export async function ensureSupabaseSession() {
  const sb = getSupabase();
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (session) return session;

  if (import.meta.env.VITE_SUPABASE_AUTO_ANON_AUTH === "true") {
    const { data, error } = await sb.auth.signInAnonymously();
    if (error) {
      throw new Error(
        `Supabase anonymous sign-in failed: ${error.message}. Enable Anonymous sign-ins in the Supabase dashboard.`
      );
    }
    return data.session;
  }

  throw new Error(
    "No Supabase session. Set VITE_SUPABASE_AUTO_ANON_AUTH=true (and enable Anonymous sign-ins), or sign in with magic link / OAuth when implemented."
  );
}
