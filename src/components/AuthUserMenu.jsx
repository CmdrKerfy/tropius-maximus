/**
 * Profile dropdown in the app header (Phase 1 primitive adoption).
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "../lib/supabaseClient.js";
import { isEmailAuthRequired } from "../lib/authInvite.js";
import { fetchProfile } from "../db.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/DropdownMenu.jsx";

function initialsFrom(value) {
  const text = String(value || "").trim();
  if (!text) return "U";
  const parts = text.split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join("") || "U";
}

export default function AuthUserMenu() {
  const navigate = useNavigate();
  const [email, setEmail] = useState(null);
  const [userId, setUserId] = useState(null);

  useEffect(() => {
    if (!isEmailAuthRequired()) return undefined;
    let cancelled = false;
    getSupabase()
      .auth.getUser()
      .then(({ data: { user } }) => {
        if (!cancelled) {
          setEmail(user?.email ?? null);
          setUserId(user?.id ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEmail(null);
          setUserId(null);
        }
      });
    const { data: sub } = getSupabase().auth.onAuthStateChange((_event, session) => {
      if (!cancelled) {
        setEmail(session?.user?.email ?? null);
        setUserId(session?.user?.id ?? null);
      }
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const { data: profile } = useQuery({
    queryKey: ["profile", "headerMenu", userId || "no-user"],
    queryFn: () => fetchProfile(),
    enabled: isEmailAuthRequired() && Boolean(userId),
    staleTime: 60_000,
  });

  if (!isEmailAuthRequired() || !email) return null;

  const displayName = useMemo(() => {
    const fromProfile = profile?.display_name?.trim();
    if (fromProfile) return fromProfile;
    const fromEmail = (email || "").split("@")[0]?.trim();
    return fromEmail || "User";
  }, [email, profile?.display_name]);

  const initials = initialsFrom(displayName);
  const avatarUrl = profile?.avatar_url || null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex max-w-[14rem] items-center gap-2 rounded-full border border-white/30 bg-black/20 px-2 py-1 text-white hover:bg-black/30"
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="h-7 w-7 rounded-full object-cover border border-white/30" />
          ) : (
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-tm-leaf text-xs font-semibold text-white">
              {initials}
            </span>
          )}
          <span className="truncate text-xs font-medium">{displayName}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <div className="px-2.5 py-1.5">
          <p className="text-sm font-semibold text-gray-900">{displayName}</p>
          <p className="text-xs text-gray-500 truncate" title={email}>
            {email}
          </p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate("/dashboard")}>Dashboard</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate("/profile")}>Profile</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate("/history")}>Edit history</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-red-600 focus:bg-red-50 focus:text-red-700"
          onSelect={async () => {
            await getSupabase().auth.signOut();
            navigate("/login", { replace: true });
          }}
        >
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
