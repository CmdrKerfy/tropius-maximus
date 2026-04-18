/**
 * Edit display name (and future avatar). Email is read-only from session.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getSupabase } from "../lib/supabaseClient.js";
import { fetchProfile, upsertProfile } from "../db.js";
import AuthUserMenu from "../components/AuthUserMenu.jsx";

export default function ProfilePage() {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");

  const { data: profile, isLoading } = useQuery({
    queryKey: ["profile"],
    queryFn: () => fetchProfile(),
  });

  useEffect(() => {
    let cancelled = false;
    getSupabase()
      .auth.getUser()
      .then(({ data: { user } }) => {
        if (!cancelled) setEmail(user?.email ?? "");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (profile && typeof profile.display_name === "string") {
      setDisplayName(profile.display_name);
    }
  }, [profile]);

  const saveMutation = useMutation({
    mutationFn: () => upsertProfile({ display_name: displayName }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
  });

  useEffect(() => {
    if (!saveMutation.isSuccess) return undefined;
    const t = window.setTimeout(() => saveMutation.reset(), 2500);
    return () => window.clearTimeout(t);
  }, [saveMutation.isSuccess, saveMutation]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="bg-green-800 text-white shadow">
        <div className="max-w-3xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-semibold">Profile</h1>
            <nav className="flex gap-3 text-sm text-green-100">
              <Link to="/dashboard" className="hover:text-white hover:underline">
                Dashboard
              </Link>
              <Link to="/" className="hover:text-white hover:underline">
                Explore
              </Link>
            </nav>
          </div>
          <AuthUserMenu />
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-8">
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <p className="text-sm text-gray-600 break-all">{email || "—"}</p>
            <p className="text-xs text-gray-500 mt-1">Email cannot be changed here.</p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveMutation.mutate();
            }}
            className="space-y-4"
          >
            <div>
              <label htmlFor="display-name" className="block text-sm font-medium text-gray-700 mb-1">
                Display name
              </label>
              <input
                id="display-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={120}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-600"
                placeholder="How your name appears in the app"
                disabled={isLoading}
              />
            </div>
            {saveMutation.isError && (
              <p className="text-sm text-red-600" role="alert">
                {saveMutation.error?.message || "Could not save"}
              </p>
            )}
            {saveMutation.isSuccess && (
              <p className="text-sm text-green-700" role="status">
                Saved.
              </p>
            )}
            <button
              type="submit"
              disabled={saveMutation.isPending || isLoading}
              className="w-full py-2.5 rounded-md bg-green-600 text-white text-sm font-semibold hover:bg-green-700 disabled:opacity-50"
            >
              {saveMutation.isPending ? "Saving…" : "Save profile"}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
