/**
 * Browser Supabase client (anon key). RLS requires an authenticated session
 * (e.g. anonymous sign-in — see supabaseAuthBootstrap.js).
 */
import { createClient } from "@supabase/supabase-js";

let _client = null;

export function isSupabaseConfigured() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  return Boolean(url && key && url !== "https://your-project-id.supabase.co");
}

export function assertSupabaseConfigured() {
  if (!isSupabaseConfigured()) {
    throw new Error(
      "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.local."
    );
  }
}

/** @returns {import("@supabase/supabase-js").SupabaseClient} */
export function getSupabase() {
  assertSupabaseConfigured();
  if (!_client) {
    _client = createClient(
      import.meta.env.VITE_SUPABASE_URL,
      import.meta.env.VITE_SUPABASE_ANON_KEY,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          flowType: "pkce",
          detectSessionInUrl: true,
        },
      }
    );
  }
  return _client;
}
