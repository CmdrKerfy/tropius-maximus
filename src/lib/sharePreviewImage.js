/**
 * First non-empty image URL for public share (RPC + legacy columns).
 * Hedges against odd JSON/typing from PostgREST for share_preview_image.
 * @param {Record<string, unknown> | null | undefined} data
 * @returns {string}
 */
export function resolveShareImageUrl(data) {
  if (!data || typeof data !== "object") return "";
  const cands = [data.share_preview_image, data.image_override, data.image_large, data.image_small];
  for (const c of cands) {
    if (c == null) continue;
    const s = typeof c === "string" ? c.trim() : String(c).trim();
    if (s && s !== "null" && s !== "undefined") return s;
  }
  return "";
}
