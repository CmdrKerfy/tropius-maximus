/**
 * OAuth / PKCE callback: exchange ?code= for session after magic link.
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
      const { error: exErr } = await sb.auth.exchangeCodeForSession(window.location.href);
      if (exErr) {
        setError(exErr.message);
        return;
      }
      navigate("/", { replace: true });
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
