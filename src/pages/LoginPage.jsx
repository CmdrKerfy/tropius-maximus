/**
 * Invite-only magic link: email + team code → Edge Function request-magic-link.
 */
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getSupabase } from "../lib/supabaseClient.js";
import { getMagicLinkRequestUrl, isEmailAuthRequired } from "../lib/authInvite.js";

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from || "/";

  const [email, setEmail] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isEmailAuthRequired()) {
      navigate("/", { replace: true });
      return;
    }
    let cancelled = false;
    getSupabase()
      .auth.getSession()
      .then(({ data: { session } }) => {
        if (!cancelled && session) navigate(from, { replace: true });
      });
    return () => {
      cancelled = true;
    };
  }, [navigate, from]);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    const url = getMagicLinkRequestUrl();
    const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;
    if (!url || !anon) {
      setError("Supabase URL or anon key is not configured.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${anon}`,
          apikey: anon,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: email.trim(), inviteCode: inviteCode.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Request failed (${res.status})`);
        return;
      }
      setMessage(data.message || "Check your email for the sign-in link.");
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md bg-white rounded-lg shadow-md border border-gray-200 p-8">
        <h1 className="text-xl font-bold text-gray-900 mb-1">Sign in</h1>
        <p className="text-sm text-gray-600 mb-6">
          Enter the email on your invite list and the team code. We will email you a magic link.
        </p>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label htmlFor="login-email" className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-600"
            />
          </div>
          <div>
            <label htmlFor="login-code" className="block text-sm font-medium text-gray-700 mb-1">
              Team invite code
            </label>
            <input
              id="login-code"
              type="password"
              autoComplete="off"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              required
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-600"
            />
          </div>
          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}
          {message && (
            <p className="text-sm text-green-700" role="status">
              {message}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full py-2.5 rounded-md bg-green-600 text-white text-sm font-semibold hover:bg-green-700 disabled:opacity-50"
          >
            {busy ? "Sending…" : "Send magic link"}
          </button>
        </form>
      </div>
      <p className="mt-6 text-xs text-gray-500 text-center max-w-md">
        After you click the link in your email, you will return to the app signed in. Check spam if nothing
        arrives within a minute or two.
      </p>
    </div>
  );
}
