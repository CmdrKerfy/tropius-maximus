/**
 * Vercel Edge: send known crawlers to /api/share-og for Open Graph HTML; humans get the SPA.
 */
const BOT_UA =
  /facebookexternalhit|Facebot|WhatsApp|Twitterbot|Slackbot|Slack-ImgProxy|Discordbot|TelegramBot|Pinterest|LinkedInBot|Embedly|vkShare|redditbot|Applebot|Googlebot|bingbot|Yandex|Baiduspider/i;

export const config = {
  matcher: "/share/card/:path*",
};

export default function middleware(request) {
  const ua = request.headers.get("user-agent") || "";
  if (!BOT_UA.test(ua)) {
    return fetch(request);
  }

  const url = new URL(request.url);
  const m = url.pathname.match(/^\/share\/card\/(.+)$/);
  if (!m) {
    return fetch(request);
  }

  const cardId = decodeURIComponent(m[1]);
  const og = new URL("/api/share-og", url.origin);
  og.searchParams.set("cardId", cardId);
  return fetch(og.toString(), {
    headers: { "user-agent": ua },
  });
}
