/**
 * Invite gate: shared INVITE_SECRET + email must exist in public.signup_allowlist.
 * Then sends Supabase magic-link email via service-role signInWithOtp.
 *
 * Secrets (Dashboard → Edge Functions → Secrets, or supabase secrets set):
 *   INVITE_SECRET       — team passphrase (rotate if leaked)
 *   SITE_URL            — optional; e.g. https://your-app.vercel.app (for email redirect)
 *
 * Auto-provided by Supabase: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const e = raw.trim().toLowerCase();
  if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
  return e;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const inviteSecret = Deno.env.get("INVITE_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!inviteSecret || !supabaseUrl || !serviceKey) {
    return json({ error: "Server misconfigured" }, 500);
  }

  let body: { email?: string; inviteCode?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const code = typeof body.inviteCode === "string" ? body.inviteCode.trim() : "";
  if (!code || code !== inviteSecret) {
    return json({ error: "Invalid invite code" }, 401);
  }

  const email = normalizeEmail(body.email);
  if (!email) return json({ error: "Invalid email" }, 400);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: row, error: qerr } = await admin
    .from("signup_allowlist")
    .select("email")
    .eq("email", email)
    .maybeSingle();

  if (qerr) {
    console.error("allowlist query", qerr);
    return json({ error: "Could not verify invite" }, 500);
  }
  if (!row) {
    return json({ error: "Email not on invite list" }, 403);
  }

  const siteUrl = (Deno.env.get("SITE_URL") || "").trim().replace(/\/$/, "");
  const origin = (req.headers.get("origin") || "").trim().replace(/\/$/, "");
  const redirectBase = siteUrl || origin;
  const emailRedirectTo = redirectBase
    ? `${redirectBase}/auth/callback`
    : undefined;

  const { error: oerr } = await admin.auth.signInWithOtp({
    email,
    options: emailRedirectTo ? { emailRedirectTo } : undefined,
  });

  if (oerr) {
    console.error("signInWithOtp", oerr);
    return json({ error: oerr.message || "Could not send login email" }, 400);
  }

  return json({ ok: true, message: "Check your email for the sign-in link." });
});
