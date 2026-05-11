/**
 * Returns true if the string contains CJK characters (kanji, hiragana,
 * katakana, or half-width katakana). Used to route searches to the
 * client-side matching path since pg_trgm can't accelerate CJK ILIKE.
 */
export function hasCjkChars(str) {
  if (!str) return false;
  return /[぀-ゟ゠-ヿ･-ﾟ一-鿿㐀-䶿]/.test(str);
}
