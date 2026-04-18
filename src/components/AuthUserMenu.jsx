/**
 * Signed-in email + sign out when invite / email auth is enabled.
 */
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getSupabase } from "../lib/supabaseClient.js";
import { isEmailAuthRequired } from "../lib/authInvite.js";

export default function AuthUserMenu() {
  const navigate = useNavigate();
  const [email, setEmail] = useState(null);

  useEffect(() => {
    if (!isEmailAuthRequired()) return undefined;
    let cancelled = false;
    getSupabase()
      .auth.getUser()
      .then(({ data: { user } }) => {
        if (!cancelled) setEmail(user?.email ?? null);
      })
      .catch(() => {
        if (!cancelled) setEmail(null);
      });
    const { data: sub } = getSupabase().auth.onAuthStateChange((_event, session) => {
      if (!cancelled) setEmail(session?.user?.email ?? null);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (!isEmailAuthRequired() || !email) return null;

  return (
    <div className="flex items-center gap-2 text-sm flex-wrap justify-end">
      <Link to="/dashboard" className="text-green-100 hover:text-white hover:underline text-xs font-medium">
        Dashboard
      </Link>
      <Link to="/profile" className="text-green-100 hover:text-white hover:underline text-xs font-medium">
        Profile
      </Link>
      <span className="text-green-100 truncate max-w-[10rem] sm:max-w-[14rem]" title={email}>
        {email}
      </span>
      <button
        type="button"
        onClick={async () => {
          await getSupabase().auth.signOut();
          navigate("/login", { replace: true });
        }}
        className="px-2 py-1 rounded bg-green-700 hover:bg-green-800 text-white text-xs font-medium"
      >
        Sign out
      </button>
    </div>
  );
}
