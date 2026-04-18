/**
 * Finish password reset after user opens the email link (session from URL hash).
 */
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getSupabase } from "../lib/supabaseClient.js";
import { isEmailAuthRequired } from "../lib/authInvite.js";

export default function AuthResetPasswordPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isEmailAuthRequired()) {
      navigate("/", { replace: true });
      return;
    }
    let cancelled = false;
    const run = async () => {
      const sb = getSupabase();
      const {
        data: { session },
      } = await sb.auth.getSession();
      if (cancelled) return;
      setHasSession(Boolean(session));
      setLoading(false);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    if (password !== password2) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      const { error: uErr } = await getSupabase().auth.updateUser({ password });
      if (uErr) {
        setError(uErr.message);
        return;
      }
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="inline-block w-10 h-10 border-4 border-green-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!hasSession) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-md bg-white rounded-lg shadow-md border border-gray-200 p-8 text-center">
          <h1 className="text-lg font-semibold text-gray-900 mb-2">Link invalid or expired</h1>
          <p className="text-sm text-gray-600 mb-4">
            Request a new reset link from the login page under &quot;Forgot password&quot;.
          </p>
          <Link to="/login" className="text-green-700 text-sm font-medium hover:underline">
            Return to login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md bg-white rounded-lg shadow-md border border-gray-200 p-8">
        <h1 className="text-xl font-bold text-gray-900 mb-1">Set new password</h1>
        <p className="text-sm text-gray-600 mb-6">Choose a new password for your account.</p>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label htmlFor="np" className="block text-sm font-medium text-gray-700 mb-1">
              New password
            </label>
            <input
              id="np"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-600"
            />
          </div>
          <div>
            <label htmlFor="np2" className="block text-sm font-medium text-gray-700 mb-1">
              Confirm password
            </label>
            <input
              id="np2"
              type="password"
              autoComplete="new-password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              required
              minLength={8}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-600"
            />
          </div>
          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full py-2.5 rounded-md bg-green-600 text-white text-sm font-semibold hover:bg-green-700 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Update password"}
          </button>
        </form>
      </div>
    </div>
  );
}
