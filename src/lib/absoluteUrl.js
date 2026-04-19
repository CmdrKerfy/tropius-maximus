/**
 * Resolve stored card image URLs for display or OG tags: absolute https, protocol-relative, or relative to a site origin.
 * Keeps browser share page behavior aligned with `api/share-og.js`.
 *
 * @param {unknown} maybeUrl
 * @param {string} baseOrigin e.g. `window.location.origin` or `https://example.com`
 * @returns {string} Empty string if not resolvable.
 */
export function absoluteUrl(maybeUrl, baseOrigin) {
  if (!maybeUrl || typeof maybeUrl !== "string") return "";
  const t = maybeUrl.trim();
  if (!t) return "";
  if (/^https?:\/\//i.test(t)) return t;
  if (t.startsWith("//")) return `https:${t}`;
  const base = baseOrigin && typeof baseOrigin === "string" ? baseOrigin : "https://localhost";
  try {
    return new URL(t, base).href;
  } catch {
    return "";
  }
}
