/**
 * Stale-build detection for lazy chunks. After a deploy, a tab still running
 * the old build requests hashed chunks that no longer exist (404), and the
 * lazy import rejects. Error boundaries use this to reload onto the new build
 * instead of showing an error.
 */
const CHUNK_ERROR_PATTERNS = [
  "dynamically imported module", // Chrome "Failed to fetch …", Firefox "error loading …"
  "importing a module script failed", // Safari
  "unable to preload css", // Vite CSS preload
  "loading chunk",
  "loading css chunk",
];

const RELOAD_STORAGE_KEY = "tm_chunk_reload_at";
/** A second chunk failure this soon after an automatic reload is not a stale tab. */
export const CHUNK_RELOAD_GUARD_MS = 30_000;

export function isChunkLoadError(error) {
  if (!error) return false;
  if (String(error.name || "") === "ChunkLoadError") return true;
  const msg = String(error.message ?? error).toLowerCase();
  return CHUNK_ERROR_PATTERNS.some((p) => msg.includes(p));
}

/**
 * Reload the page once for a chunk load failure. Returns false (no reload)
 * when an automatic reload already happened within CHUNK_RELOAD_GUARD_MS, or
 * when sessionStorage is unavailable to record it, so a genuinely missing
 * chunk shows the error (with a manual Refresh) instead of reloading in a loop.
 */
export function reloadForChunkError({
  storage = safeSessionStorage(),
  now = Date.now(),
  reload = () => window.location.reload(),
} = {}) {
  try {
    const last = Number(storage.getItem(RELOAD_STORAGE_KEY)) || 0;
    if (last && now - last >= 0 && now - last < CHUNK_RELOAD_GUARD_MS) return false;
    storage.setItem(RELOAD_STORAGE_KEY, String(now));
  } catch {
    return false;
  }
  reload();
  return true;
}

function safeSessionStorage() {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}
