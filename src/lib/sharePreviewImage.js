const TCGDEX_ASSET_HOST = "assets.tcgdex.net";
const TCGDEX_FILE_RE = /^(high|low)\.(webp|png|jpg)$/i;

/**
 * tcgdex stores a card's image as a base path (`…/en/tcgp/P-A/054`) that serves an
 * HTML page; the actual files live under it as `{high|low}.{webp|png|jpg}`.
 * Returns the base with `/high.{format}`, or swaps an existing file's format.
 * Non-tcgdex URLs are returned unchanged.
 * @param {string} url
 * @param {"webp" | "png" | "jpg"} [format]
 * @returns {string}
 */
export function tcgdexAssetImageUrl(url, format = "webp") {
  if (!url || typeof url !== "string") return url;
  let u;
  try {
    u = new URL(url.trim());
  } catch {
    return url;
  }
  if (u.hostname !== TCGDEX_ASSET_HOST) return url;
  const segs = u.pathname.replace(/\/+$/, "").split("/");
  const last = segs[segs.length - 1] || "";
  const m = last.match(TCGDEX_FILE_RE);
  if (m) {
    segs[segs.length - 1] = `${m[1].toLowerCase()}.${format}`;
  } else if (!last.includes(".")) {
    segs.push(`high.${format}`);
  } else {
    return url;
  }
  u.pathname = segs.join("/");
  return u.toString();
}

function shareImageFields(data) {
  if (!data || typeof data !== "object") return [];
  const out = [];
  for (const c of [data.share_preview_image, data.image_override, data.image_large, data.image_small]) {
    if (c == null) continue;
    const s = typeof c === "string" ? c.trim() : String(c).trim();
    if (s && s !== "null" && s !== "undefined") out.push(s);
  }
  return out;
}

/**
 * First non-empty image URL for public share (RPC + legacy columns).
 * Hedges against odd JSON/typing from PostgREST for share_preview_image.
 * @param {Record<string, unknown> | null | undefined} data
 * @returns {string}
 */
export function resolveShareImageUrl(data) {
  const first = shareImageFields(data)[0];
  return first ? tcgdexAssetImageUrl(first, "webp") : "";
}

/**
 * Ordered, de-duplicated og:image candidates. tcgdex images are requested as JPEG:
 * chat link previews (WhatsApp, iMessage) often skip WebP, and `high.jpg` is ~90 KB.
 * @param {Record<string, unknown> | null | undefined} data
 * @returns {string[]}
 */
export function shareOgImageCandidates(data) {
  const seen = new Set();
  const out = [];
  for (const s of shareImageFields(data)) {
    const u = tcgdexAssetImageUrl(s, "jpg");
    if (!seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
  }
  return out;
}
