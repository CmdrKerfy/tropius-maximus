/**
 * Vercel Edge: for `/share/card/*`, serve Open Graph HTML to everyone except
 * real browser top-level document navigations (Fetch Metadata: Sec-Fetch-*).
 *
 * Chat app link preview (WhatsApp, iMessage, etc.) usually does NOT use a
 * listed bot User-Agent, so UA-only routing misses. Those fetches also omit
 * `Sec-Fetch-Dest: document` + `Sec-Fetch-Mode: navigate`—they are not
 * a normal tab navigation—so they must receive the pre-rendered `/api/share-og`
 * response, not the Vite SPA HTML (no per-card `og:image`).
 */
export const config = {
  matcher: "/share/card/:path*",
};

const VARY = "Sec-Fetch-Dest, Sec-Fetch-Mode";

/**
 * @param {Promise<Response>} resPromise
 */
async function withVary(resPromise) {
  const res = await resPromise;
  const headers = new Headers(res.headers);
  headers.set("Vary", VARY);
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

export default async function middleware(request) {
  if (request.method !== "GET") {
    return fetch(request);
  }

  const url = new URL(request.url);
  if (!url.pathname.startsWith("/share/card/") || url.pathname.length <= "/share/card/".length) {
    return fetch(request);
  }

  const dest = request.headers.get("sec-fetch-dest");
  const mode = request.headers.get("sec-fetch-mode");

  if (dest === "document" && mode === "navigate") {
    return withVary(fetch(request));
  }

  const m = url.pathname.match(/^\/share\/card\/(.+)$/);
  if (!m) {
    return fetch(request);
  }

  const cardId = decodeURIComponent(m[1]);
  const og = new URL("/api/share-og", url.origin);
  og.searchParams.set("cardId", cardId);
  const ua = request.headers.get("user-agent") || "";
  return withVary(
    fetch(og.toString(), {
      headers: { "user-agent": ua },
    })
  );
}
