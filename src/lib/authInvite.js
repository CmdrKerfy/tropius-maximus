/**
 * Invite-only magic link: POST to Edge Function request-magic-link.
 */
export function getMagicLinkRequestUrl() {
  const base = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, "");
  if (!base) return null;
  return `${base}/functions/v1/request-magic-link`;
}

export function isEmailAuthRequired() {
  return (
    import.meta.env.VITE_USE_SUPABASE === "true" &&
    import.meta.env.VITE_REQUIRE_EMAIL_AUTH === "true"
  );
}
