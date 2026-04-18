/**
 * Invite-gated email + password signup (or set password for existing auth user).
 * Validates INVITE_SECRET + signup_allowlist, then creates or updates auth user via Admin API.
 *
 * Secrets: INVITE_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto)
 * Optional: SITE_URL (for consistency with other functions)
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

function validPassword(p: string): boolean {
  if (p.length < 8 || p.length > 72) return false;
  return true;
}

async function findUserIdByEmail(
  admin: ReturnType<typeof createClient>,
  email: string
): Promise<string | null> {
  let page = 1;
  const perPage = 200;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const u = data.users.find((x) => (x.email || "").toLowerCase() === email);
    if (u) return u.id;
    if (data.users.length < perPage) return null;
    page += 1;
    if (page > 50) return null;
  }
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

  let body: { email?: string; inviteCode?: string; password?: string };
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

  const password = typeof body.password === "string" ? body.password : "";
  if (!validPassword(password)) {
    return json({ error: "Password must be between 8 and 72 characters" }, 400);
  }

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

  try {
    const existingId = await findUserIdByEmail(admin, email);
    if (existingId) {
      const { error: uerr } = await admin.auth.admin.updateUserById(existingId, {
        password,
        email_confirm: true,
      });
      if (uerr) {
        console.error("updateUser", uerr);
        return json({ error: uerr.message || "Could not set password" }, 400);
      }
      return json({ ok: true, message: "Password updated. You can sign in." });
    }

    const { error: cerr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (cerr) {
      console.error("createUser", cerr);
      return json({ error: cerr.message || "Could not create account" }, 400);
    }
    return json({ ok: true, message: "Account created. You can sign in." });
  } catch (e) {
    console.error(e);
    return json({ error: "Unexpected server error" }, 500);
  }
});
