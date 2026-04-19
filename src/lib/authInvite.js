/**
 * Invite-only magic link: POST to Edge Function request-magic-link.
 */
export function getMagicLinkRequestUrl() {
  const base = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, "");
  if (!base) return null;
  return `${base}/functions/v1/request-magic-link`;
}

/** Invite-gated create account / set password (email + password auth). */
export function getInviteSetPasswordUrl() {
  const base = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, "");
  if (!base) return null;
  return `${base}/functions/v1/invite-set-password`;
}

export function isEmailAuthRequired() {
  return (
    import.meta.env.VITE_USE_SUPABASE === "true" &&
    import.meta.env.VITE_REQUIRE_EMAIL_AUTH === "true"
  );
}

/**
 * True when the session is a real member (email/password, magic link, OAuth).
 * Anonymous Supabase sessions are excluded so they cannot access protected routes or prefetch app data.
 */
export function isNonAnonymousSession(session) {
  return Boolean(session?.user && !session.user.is_anonymous);
}
