/**
 * Vercel serverless: HTML with Open Graph tags for link previews (bots redirected here from middleware).
 */
import { createClient } from "@supabase/supabase-js";
import { absoluteUrl } from "../src/lib/absoluteUrl.js";

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Served from `public/`; Vercel/static deploy exposes at site root. Use PNG: many link previews ignore SVG. */
const OG_PLACEHOLDER_PATH = "/og-card-placeholder.png";
/** Dimensions of `OG_PLACEHOLDER_PATH` (solid slate); helps some scrapers accept og:image. */
const OG_PLACEHOLDER_WIDTH = 1200;
const OG_PLACEHOLDER_HEIGHT = 630;

function cacheHeaders(status) {
  if (status === 200) {
    return {
      "Cache-Control":
        "public, max-age=300, s-maxage=1800, stale-while-revalidate=86400",
    };
  }
  if (status === 404) {
    return {
      "Cache-Control": "public, max-age=120, s-maxage=300",
    };
  }
  return { "Cache-Control": "no-store" };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).setHeader("Allow", "GET");
    Object.entries(cacheHeaders(405)).forEach(([k, v]) => res.setHeader(k, v));
    res.end("Method Not Allowed");
    return;
  }

  const raw = req.query?.cardId;
  const cardId = typeof raw === "string" ? raw.trim() : Array.isArray(raw) ? String(raw[0] ?? "").trim() : "";
  if (!cardId || cardId.length > 512) {
    res.status(400).setHeader("Content-Type", "text/plain; charset=utf-8");
    Object.entries(cacheHeaders(400)).forEach(([k, v]) => res.setHeader(k, v));
    res.end("Missing or invalid cardId");
    return;
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    res.status(500).setHeader("Content-Type", "text/plain; charset=utf-8");
    Object.entries(cacheHeaders(500)).forEach(([k, v]) => res.setHeader(k, v));
    res.end("Server missing Supabase env");
    return;
  }

  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const origin = `${proto}://${host}`;
  const sharePath = `/share/card/${encodeURIComponent(cardId)}`;
  const canonicalUrl = `${origin}${sharePath}`;

  const sb = createClient(supabaseUrl, supabaseKey);
  const { data, error } = await sb.rpc("get_public_card_for_share", { p_card_id: cardId });

  if (error) {
    console.error("[share-og] RPC get_public_card_for_share:", error.message || error);
    res.status(502).setHeader("Content-Type", "text/plain; charset=utf-8");
    Object.entries(cacheHeaders(502)).forEach(([k, v]) => res.setHeader(k, v));
    res.end("Could not load card preview.");
    return;
  }

  if (!data || typeof data !== "object") {
    res.status(404).setHeader("Content-Type", "text/html; charset=utf-8");
    Object.entries(cacheHeaders(404)).forEach(([k, v]) => res.setHeader(k, v));
    res.end(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Card not found</title></head><body><p>Card not found.</p></body></html>`
    );
    return;
  }

  const title = escapeHtml(data.name || "Pokémon card");
  const subtitle = [data.set_name, data.number ? `#${data.number}` : null].filter(Boolean).join(" · ");
  const desc = escapeHtml(subtitle || data.set_series || "Shared from Tropius Maximus");
  const imgRaw = data.image_override || data.image_large || data.image_small;
  const fromCard = absoluteUrl(imgRaw, origin);
  const ogImage = fromCard || `${origin}${OG_PLACEHOLDER_PATH}`;
  const usePlaceholder = !fromCard;
  const ogImageDims = usePlaceholder
    ? `  <meta property="og:image:width" content="${OG_PLACEHOLDER_WIDTH}">\n  <meta property="og:image:height" content="${OG_PLACEHOLDER_HEIGHT}">\n`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <meta name="description" content="${desc}">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${desc}">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  <meta property="og:image" content="${escapeHtml(ogImage)}">
${ogImageDims}  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${desc}">
  <meta name="twitter:image" content="${escapeHtml(ogImage)}">
</head>
<body>
  <p><a href="${escapeHtml(canonicalUrl)}">Open card</a></p>
</body>
</html>`;

  res.status(200).setHeader("Content-Type", "text/html; charset=utf-8");
  Object.entries(cacheHeaders(200)).forEach(([k, v]) => res.setHeader(k, v));
  res.end(html);
}
