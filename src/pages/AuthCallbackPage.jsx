/**
 * Auth callback after magic link: ?code= exchange (server-sent OTP) or hash tokens (implicit grant).
 */
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getSupabase } from "../lib/supabaseClient.js";

export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const run = async () => {
      const sb = getSupabase();
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");

      if (code) {
        const { error: exErr } = await sb.auth.exchangeCodeForSession(code);
        if (exErr) {
          setError(exErr.message);
          return;
        }
        navigate("/dashboard", { replace: true });
        return;
      }

      const {
        data: { session },
        error: sessErr,
      } = await sb.auth.getSession();
      if (sessErr) {
        setError(sessErr.message);
        return;
      }
      if (!session) {
        setError("Missing sign-in code or session. Request a new link from the login page.");
        return;
      }
      navigate("/dashboard", { replace: true });
    };
    void run();
  }, [navigate]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md text-center">
          <h1 className="text-lg font-semibold text-gray-900 mb-2">Could not sign in</h1>
          <p className="text-sm text-red-600 mb-4">{error}</p>
          <Link to="/login" className="text-green-700 text-sm font-medium hover:underline">
            Return to login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="inline-block w-10 h-10 border-4 border-green-600 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-gray-600 text-sm">Completing sign-in…</p>
      </div>
    </div>
  );
}
