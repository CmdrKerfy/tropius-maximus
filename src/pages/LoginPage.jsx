/**
 * Email + password sign-in; invite-gated account creation via Edge Function invite-set-password.
 */
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { getSupabase } from "../lib/supabaseClient.js";
import { getInviteSetPasswordUrl, isEmailAuthRequired } from "../lib/authInvite.js";

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from || "/dashboard";

  const [mode, setMode] = useState("signin"); // signin | signup | forgot

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [password2, setPassword2] = useState("");

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

  async function onSignIn(e) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const { error: signErr } = await getSupabase().auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signErr) {
        setError(signErr.message);
        return;
      }
      navigate(from, { replace: true });
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onCreateAccount(e) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    if (password !== password2) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    const url = getInviteSetPasswordUrl();
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
        body: JSON.stringify({
          email: email.trim(),
          inviteCode: inviteCode.trim(),
          password,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Request failed (${res.status})`);
        return;
      }
      setMessage(data.message || "Account ready. Signing you in…");
      const { error: signErr } = await getSupabase().auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signErr) {
        setMessage(null);
        setError(signErr.message || "Account created but sign-in failed. Try Sign in below.");
        setMode("signin");
        return;
      }
      navigate(from, { replace: true });
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onForgot(e) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const redirectTo = new URL(
        "auth/reset-password",
        new URL(import.meta.env.BASE_URL || "/", window.location.origin)
      ).href;
      const { error: fErr } = await getSupabase().auth.resetPasswordForEmail(email.trim(), {
        redirectTo,
      });
      if (fErr) {
        setError(fErr.message);
        return;
      }
      setMessage("If that email is registered, you will receive a reset link shortly.");
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md bg-white rounded-lg shadow-md border border-gray-200 p-8">
        <h1 className="text-xl font-bold text-gray-900 mb-1">Sign in</h1>
        <p className="text-sm text-gray-600 mb-4">
          {mode === "signin" && "Use the email on your invite list and your password."}
          {mode === "signup" &&
            "First time: enter email, team invite code, and choose a password (8+ characters)."}
          {mode === "forgot" && "We will email you a link to set a new password."}
        </p>

        <div className="flex gap-2 mb-6 text-xs">
          <button
            type="button"
            className={`px-2 py-1 rounded ${mode === "signin" ? "bg-green-100 text-green-900 font-medium" : "text-gray-600"}`}
            onClick={() => {
              setMode("signin");
              setError(null);
              setMessage(null);
            }}
          >
            Sign in
          </button>
          <button
            type="button"
            className={`px-2 py-1 rounded ${mode === "signup" ? "bg-green-100 text-green-900 font-medium" : "text-gray-600"}`}
            onClick={() => {
              setMode("signup");
              setError(null);
              setMessage(null);
            }}
          >
            Create account
          </button>
          <button
            type="button"
            className={`px-2 py-1 rounded ${mode === "forgot" ? "bg-green-100 text-green-900 font-medium" : "text-gray-600"}`}
            onClick={() => {
              setMode("forgot");
              setError(null);
              setMessage(null);
            }}
          >
            Forgot password
          </button>
        </div>

        {mode === "signin" && (
          <form onSubmit={onSignIn} className="space-y-4">
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
              <label htmlFor="login-password" className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <input
                id="login-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
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
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
        )}

        {mode === "signup" && (
          <form onSubmit={onCreateAccount} className="space-y-4">
            <div>
              <label htmlFor="su-email" className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <input
                id="su-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-600"
              />
            </div>
            <div>
              <label htmlFor="su-code" className="block text-sm font-medium text-gray-700 mb-1">
                Team invite code
              </label>
              <input
                id="su-code"
                type="password"
                autoComplete="off"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                required
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-600"
              />
            </div>
            <div>
              <label htmlFor="su-pw" className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <input
                id="su-pw"
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
              <label htmlFor="su-pw2" className="block text-sm font-medium text-gray-700 mb-1">
                Confirm password
              </label>
              <input
                id="su-pw2"
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
              {busy ? "Working…" : "Create account"}
            </button>
          </form>
        )}

        {mode === "forgot" && (
          <form onSubmit={onForgot} className="space-y-4">
            <div>
              <label htmlFor="fg-email" className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <input
                id="fg-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
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
              {busy ? "Sending…" : "Send reset link"}
            </button>
          </form>
        )}
      </div>
      <p className="mt-6 text-xs text-gray-500 text-center max-w-md">
        <Link to="/" className="text-green-700 hover:underline">
          Back to Explore
        </Link>
        {" · "}
        Ensure the project owner has added your email to the invite list and deployed the{" "}
        <code className="text-[11px]">invite-set-password</code> Edge Function.
      </p>
    </div>
  );
}
