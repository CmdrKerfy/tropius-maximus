/**
 * Pokémon TCG Pocket cards are TCGdex rows that are not Japanese. Japanese
 * printed cards share the `tcgdex` origin (and `ptcgdb` is Japanese-only), so
 * origin alone must not decide the Pocket label. Matches the Explore
 * Source=Pocket query (origin = tcgdex, origin_detail not 'japanese').
 */
export function isPocketOrigin(origin, originDetail) {
  return (
    String(origin || "").toLowerCase() === "tcgdex" &&
    String(originDetail || "").toLowerCase() !== "japanese"
  );
}
