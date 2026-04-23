/**
 * Vercel Edge: send known crawlers to /api/share-og for Open Graph HTML; humans get the SPA.
 * Expand this list when a messenger/crawler does not match and previews fall back to generic HTML.
 * (iMessage, WhatsApp, Facebook, Slack, Discord, Telegram, LinkedIn, Pinterest, Reddit, search bots, etc.)
 */
const BOT_UA =
  /facebookexternalhit|Facebot|WhatsApp|Twitterbot|Slackbot|Slack-ImgProxy|Slackbot-LinkExpanding|Discordbot|Discordapp|TelegramBot|Pinterest|LinkedInBot|Embedly|vkShare|redditbot|Applebot|Googlebot|Google-Structured-Data-Testing-Tool|bingbot|Yandex|Baiduspider|Bytespider|TikTok|Snapchat|Instagram|SkypeUriPreview|MicrosoftPreview|Teams|Iframely|opengraph\.io|Mastodon|Showyoubot|Outbrain|trendiction|Mail\.RU_Bot|Quora|Slurp|DuckDuckBot|KakaoTalk|KAKAOTALK|Line\/|NAVER\(|Naverbot|Viber|Signal|Kik\//i;

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
