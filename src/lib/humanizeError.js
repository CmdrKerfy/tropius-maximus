/** Fallback when we cannot show a safe, short line. */
const GENERIC = "Something went wrong. Please try again. If it keeps happening, note what you were doing and ask for help.";

/**
 * Turn API / Postgres / network errors into short, plain-English copy for toasts and UI.
 * Known-good caller strings (no technical markers) pass through unchanged.
 * @param {unknown} err
 * @returns {string}
 */
export function humanizeError(err) {
  const raw = extractMessage(err);
  const t = String(raw ?? "").trim();
  if (!t) return GENERIC;

  const low = t.toLowerCase();

  if (/^https?:\/\//i.test(t) && t.length < 400) {
    return "A request failed. Check your connection and try again.";
  }

  if (/invalid login credentials|invalid email or password/i.test(low)) {
    return "That email or password does not match our records.";
  }

  if (/jwt expired|invalid jwt|session (has )?expired|refresh.*token|token.*expired/i.test(low)) {
    return "Your session expired. Please sign in again.";
  }

  if (/failed to fetch|networkerror|load failed|net::err|network request failed/i.test(low)) {
    return "We could not reach the server. Check your internet connection and try again.";
  }

  if (/\b(503|502|504)\b|bad gateway|service unavailable|unavailable/i.test(t)) {
    return "The service is temporarily unavailable. Try again in a few minutes.";
  }

  if (/\b429\b|rate limit|too many requests/i.test(low)) {
    return "Too many requests right now. Wait a minute and try again.";
  }

  if (/\b401\b|unauthorized\b/i.test(low)) {
    return "You need to sign in to continue. Open Log in from the menu if you were signed out.";
  }

  if (/\b403\b|forbidden\b/i.test(low) && !/permission denied for relation/i.test(low)) {
    return "You do not have permission for this action.";
  }

  if (/permission denied|row-level security|rls policy|violates row-level security|\b42501\b/i.test(low)) {
    return "You do not have permission to do this. Sign in again or ask who manages access.";
  }

  if (/duplicate key|unique constraint|already exists/i.test(low)) {
    return "That value is already in use. Try a different one.";
  }

  if (/violates foreign key|foreign key constraint|\b23503\b/i.test(low)) {
    return "That change cannot be applied because something else still depends on this record.";
  }

  if (/violates not-null|not null constraint|\b23502\b|required field/i.test(low)) {
    return "A required value was missing. Fill in the required fields and try again.";
  }

  if (/violates check constraint|check constraint/i.test(low)) {
    return "That value is not allowed here. Try something else.";
  }

  if (/invalid input syntax for type uuid/i.test(low)) {
    return "That link or ID is not valid.";
  }

  if (/value too long|exceeds maximum|character varying\(\d+\)/i.test(low)) {
    return "That text is too long for this field. Shorten it and try again.";
  }

  if (/annotation_version_conflict/i.test(low)) {
    return "Someone else saved changes to this card first. Reopen the card or refresh, then try again.";
  }

  if (/pgrst116|0 rows|contains 0 rows|json object requested.*multiple \(or no\) rows/i.test(low)) {
    return "We could not find that item. It may have been removed, or you may need to sign in.";
  }

  if (/timeout|timed out|deadline exceeded/i.test(low)) {
    return "The request took too long. Wait a moment and try again.";
  }

  if (looksLikeStackTraceOrOpaqueBlob(t, low)) {
    return GENERIC;
  }

  return t;
}

function extractMessage(err) {
  if (err == null) return "";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  if (typeof err === "object") {
    if (typeof err.message === "string") return err.message;
    if (typeof err.error_description === "string") return err.error_description;
    if (err.error && typeof err.error === "object" && typeof err.error.message === "string") {
      return err.error.message;
    }
    if (typeof err.details === "string" && err.details.trim()) return `${err.message || ""} ${err.details}`.trim();
    if (typeof err.hint === "string" && err.hint.trim()) return `${err.message || ""} (${err.hint})`.trim();
  }
  try {
    return String(err);
  } catch {
    return "";
  }
}

/** Long blobs, stack traces, or very Postgres-internal lines → generic copy. */
function looksLikeStackTraceOrOpaqueBlob(t, low) {
  if (t.length > 220) return true;
  if (/^\s*at\s+/m.test(t)) return true;
  if (/node_modules|webpack-internal|@vite|chunk-\w+\.js/i.test(t)) return true;
  if (/postgres error|severity:|sqlstate/i.test(low) && t.length > 120) return true;
  return false;
}
