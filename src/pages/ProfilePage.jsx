/**
 * Profile — edit your display name, or view a teammate (read-only) by user id.
 */
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getSupabase } from "../lib/supabaseClient.js";
import {
  fetchProfile,
  fetchProfileById,
  upsertProfile,
  uploadProfileAvatar,
  removeProfileAvatar,
  useSupabaseBackend,
} from "../db.js";
import AuthUserMenu from "../components/AuthUserMenu.jsx";

function isUuidParam(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || ""));
}

function avatarSrc(url, bust) {
  if (!url) return null;
  const u = String(url);
  const sep = u.includes("?") ? "&" : "?";
  return bust ? `${u}${sep}v=${encodeURIComponent(bust)}` : u;
}

export default function ProfilePage() {
  const { userId: userIdParam } = useParams();
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [avatarBust, setAvatarBust] = useState("");

  const useSb = useSupabaseBackend();

  const { data: sessionUser, isLoading: authLoading } = useQuery({
    queryKey: ["authSessionUser"],
    queryFn: async () => {
      const { data } = await getSupabase().auth.getUser();
      return data.user ?? null;
    },
  });

  const selfId = sessionUser?.id ?? null;
  const isOther =
    Boolean(userIdParam) && Boolean(selfId) && String(userIdParam) !== String(selfId);
  /** Bad `/profile/:userId` segments must not skip hooks below (Rules of Hooks). */
  const invalidProfileId = Boolean(userIdParam) && !isUuidParam(userIdParam);

  const { data: profile, isLoading: profileLoading, isError, error } = useQuery({
    queryKey: ["profile", userIdParam || selfId || "me", isOther ? "byId" : "self"],
    queryFn: () => (isOther ? fetchProfileById(userIdParam) : fetchProfile()),
    enabled: useSb && Boolean(selfId) && !invalidProfileId && (!userIdParam || isUuidParam(userIdParam)),
  });

  useEffect(() => {
    let cancelled = false;
    if (!isOther) {
      getSupabase()
        .auth.getUser()
        .then(({ data: { user } }) => {
          if (!cancelled) setEmail(user?.email ?? "");
        });
    } else {
      setEmail("");
    }
    return () => {
      cancelled = true;
    };
  }, [isOther]);

  useEffect(() => {
    if (profile && typeof profile.display_name === "string") {
      setDisplayName(profile.display_name);
    } else if (profile === null && !profileLoading) {
      setDisplayName("");
    }
  }, [profile, profileLoading]);

  const saveMutation = useMutation({
    mutationFn: () => upsertProfile({ display_name: displayName }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
  });

  const avatarUploadMutation = useMutation({
    mutationFn: (file) => uploadProfileAvatar(file),
    onSuccess: (row) => {
      setAvatarBust(row?.updated_at || String(Date.now()));
      queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
  });

  const avatarRemoveMutation = useMutation({
    mutationFn: () => removeProfileAvatar(),
    onSuccess: () => {
      setAvatarBust("");
      queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
  });

  useEffect(() => {
    if (!saveMutation.isSuccess) return undefined;
    const t = window.setTimeout(() => saveMutation.reset(), 2500);
    return () => window.clearTimeout(t);
  }, [saveMutation.isSuccess, saveMutation]);

  const loading = authLoading || (useSb && selfId && profileLoading);
  const title = isOther ? "Member profile" : "Profile";

  if (invalidProfileId) {
    return <Navigate to="/profile" replace />;
  }

  if (!useSb) {
    return (
      <div className="min-h-screen bg-gray-50 text-gray-900 p-8">
        <p className="text-sm text-gray-600">Profiles are available when the app uses Supabase.</p>
        <Link to="/" className="text-green-700 text-sm mt-2 inline-block hover:underline">
          Back to Explore
        </Link>
      </div>
    );
  }

  if (!authLoading && !selfId) {
    return <Navigate to="/login" replace state={{ from: userIdParam ? `/profile/${userIdParam}` : "/profile" }} />;
  }

  const notFoundOther = isOther && !profileLoading && profile == null;

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="bg-green-800 text-white shadow">
        <div className="max-w-3xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-semibold">{title}</h1>
            <nav className="flex gap-3 text-sm text-green-100">
              <Link to="/dashboard" className="hover:text-white hover:underline">
                Dashboard
              </Link>
              <Link to="/history" className="hover:text-white hover:underline">
                Edit history
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
        {isOther && (
          <p className="text-sm text-gray-600 mb-4">
            <Link to="/history" className="text-green-700 hover:underline">
              ← Edit history
            </Link>
            {" · "}
            <Link to="/profile" className="text-green-700 hover:underline">
              My profile
            </Link>
          </p>
        )}

        {isError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error?.message || "Could not load profile."}
          </div>
        )}

        {notFoundOther && (
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 text-sm text-gray-600">
            No profile row for this user yet (they may not have signed in since profiles were enabled).
          </div>
        )}

        {isOther && profileLoading && (
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 text-sm text-gray-500">
            Loading…
          </div>
        )}

        {!notFoundOther && !(isOther && profileLoading) && (
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 space-y-5">
            {!isOther && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <p className="text-sm text-gray-600 break-all">{email || "—"}</p>
                <p className="text-xs text-gray-500 mt-1">Email cannot be changed here.</p>
              </div>
            )}

            {isOther && profile && (
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Member</p>
                {profile.avatar_url ? (
                  <img
                    src={avatarSrc(profile.avatar_url, profile.updated_at)}
                    alt=""
                    className="h-20 w-20 rounded-full object-cover border border-gray-200 mb-3"
                  />
                ) : null}
                <p className="text-sm text-gray-800">
                  {profile.display_name?.trim() || "No display name yet"}
                </p>
                {profile.created_at && (
                  <p className="text-xs text-gray-500 mt-2">
                    Profile since {new Date(profile.created_at).toLocaleDateString()}
                  </p>
                )}
              </div>
            )}

            {!isOther && (
              <div className="space-y-2">
                <span className="block text-sm font-medium text-gray-700">Photo</span>
                <div className="flex flex-wrap items-center gap-3">
                  {profile?.avatar_url ? (
                    <img
                      src={avatarSrc(profile.avatar_url, avatarBust || profile.updated_at)}
                      alt=""
                      className="h-20 w-20 rounded-full object-cover border border-gray-200"
                    />
                  ) : (
                    <div className="h-20 w-20 rounded-full bg-gray-100 border border-dashed border-gray-300 flex items-center justify-center text-xs text-gray-400 text-center px-1">
                      No photo
                    </div>
                  )}
                  <div className="flex flex-col gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      disabled={loading || avatarUploadMutation.isPending}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        if (f) avatarUploadMutation.mutate(f);
                      }}
                    />
                    <button
                      type="button"
                      disabled={loading || avatarUploadMutation.isPending}
                      onClick={() => fileInputRef.current?.click()}
                      className="text-left text-sm font-medium text-green-700 hover:underline disabled:opacity-50"
                    >
                      {avatarUploadMutation.isPending ? "Uploading…" : "Upload photo…"}
                    </button>
                    {profile?.avatar_url ? (
                      <button
                        type="button"
                        disabled={avatarRemoveMutation.isPending || avatarUploadMutation.isPending}
                        onClick={() => avatarRemoveMutation.mutate()}
                        className="text-left text-sm text-gray-600 hover:text-red-700 hover:underline disabled:opacity-50"
                      >
                        {avatarRemoveMutation.isPending ? "Removing…" : "Remove photo"}
                      </button>
                    ) : null}
                  </div>
                </div>
                <p className="text-xs text-gray-500">JPEG, PNG, or WebP · max 1 MB</p>
                {avatarUploadMutation.isError && (
                  <p className="text-sm text-red-600">{avatarUploadMutation.error?.message || "Upload failed"}</p>
                )}
                {avatarRemoveMutation.isError && (
                  <p className="text-sm text-red-600">{avatarRemoveMutation.error?.message || "Remove failed"}</p>
                )}
              </div>
            )}

            {!isOther && (
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
                    disabled={loading}
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
                  disabled={saveMutation.isPending || loading}
                  className="w-full py-2.5 rounded-md bg-green-600 text-white text-sm font-semibold hover:bg-green-700 disabled:opacity-50"
                >
                  {saveMutation.isPending ? "Saving…" : "Save profile"}
                </button>
              </form>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
