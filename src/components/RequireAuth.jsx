/**
 * When VITE_REQUIRE_EMAIL_AUTH=true, redirects anonymous users to /login.
 */
import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { getSupabase } from "../lib/supabaseClient.js";
import { isEmailAuthRequired } from "../lib/authInvite.js";

export default function RequireAuth({ children }) {
  const location = useLocation();
  const [ok, setOk] = useState(null);

  useEffect(() => {
    if (!isEmailAuthRequired()) {
      setOk(true);
      return;
    }
    let cancelled = false;
    getSupabase()
      .auth.getSession()
      .then(({ data: { session } }) => {
        if (!cancelled) setOk(Boolean(session));
      })
      .catch(() => {
        if (!cancelled) setOk(false);
      });
    const { data: sub } = getSupabase().auth.onAuthStateChange((_event, session) => {
      if (!cancelled) setOk(Boolean(session));
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (!isEmailAuthRequired()) return children;
  if (ok === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="inline-block w-10 h-10 border-4 border-green-600 border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-gray-600 text-sm">Checking sign-in…</p>
        </div>
      </div>
    );
  }
  if (!ok) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }
  return children;
}
