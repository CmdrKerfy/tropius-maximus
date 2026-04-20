/**
 * Explore grid dedupe: legacy Supabase `cards.id` variants after custom_cards id cleanup
 * (spaces / punctuation) and internal-space ids that trim-only does not merge (`custom-bjp- N/A` vs `custom-bjp-N/A`).
 *
 * Mirrors `scripts/strip_custom_card_ids.py` `normalize_card_id` for the id-normalization step.
 */

/**
 * @param {string} raw
 * @returns {string}
 */
export function normalizeCardIdForDedupe(raw) {
  let s = String(raw).trim();
  s = s.replace(/\s+/g, "-");
  s = s.replace(/-+/g, "-");
  s = s.replace(/^-+|-+$/g, "");
  return s;
}

/**
 * Stable key for Explore grid rows. Manual cards: same set + name + primary art URL ⇒ one tile
 * (duplicate PKs / pre-migration ids). Others: trimmed id.
 * @param {{ id: string, is_custom?: boolean, explore_dedupe_row_key?: string | null, set_id?: string | null, name?: string | null, image_small?: string | null, image_large?: string | null }} c
 */
export function exploreGridRowDedupeKey(c) {
  if (c.explore_dedupe_row_key != null && String(c.explore_dedupe_row_key) !== "") {
    return `preflight:${String(c.explore_dedupe_row_key)}`;
  }
  if (c.is_custom) {
    const img = String(c.image_small || c.image_large || "")
      .trim()
      .toLowerCase();
    const sid = String(c.set_id ?? "")
      .trim()
      .toLowerCase();
    const nm = String(c.name ?? "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
    if (sid && nm && img) return `m:${sid}|${nm}|${img}`;
  }
  return `id:${String(c.id).trim()}`;
}

/**
 * Prefer row whose raw `id` already equals {@link normalizeCardIdForDedupe} (canonical JSON shape).
 * @param {{ id: string }} a
 * @param {{ id: string }} b
 */
export function pickManualIdCanonicalWinner(a, b) {
  const na = normalizeCardIdForDedupe(a.id);
  const nb = normalizeCardIdForDedupe(b.id);
  const aCanon = String(a.id) === na;
  const bCanon = String(b.id) === nb;
  if (aCanon && !bCanon) return a;
  if (bCanon && !aCanon) return b;
  return pickTrimDuplicateCardRow(a, b);
}

/**
 * Merge rows that share the same trimmed `id` (legacy Postgres duplicates after
 * `custom_cards.json` id cleanup — e.g. `custom-bjp-BW-P` vs `custom-bjp-BW-P `).
 * Prefer the canonical row where `id === id.trim()`, then shorter raw id, then stable sort.
 * @param {{ id: string, is_custom?: boolean }} a
 * @param {{ id: string, is_custom?: boolean }} b
 */
export function pickTrimDuplicateCardRow(a, b) {
  const ta = String(a.id).trim();
  const tb = String(b.id).trim();
  if (ta !== tb) return String(a.id) < String(b.id) ? a : b; // call sites should pass same trim only

  const aExact = String(a.id) === ta;
  const bExact = String(b.id) === tb;
  if (aExact && !bExact) return a;
  if (bExact && !aExact) return b;

  const la = String(a.id).length;
  const lb = String(b.id).length;
  if (la !== lb) return la < lb ? a : b;

  return String(a.id) < String(b.id) ? a : b;
}

/**
 * @param {{ id: string, is_custom?: boolean }} existing
 * @param {{ id: string, is_custom?: boolean }} c
 */
export function pickExploreGridDuplicateWinner(existing, c) {
  if (c.is_custom && !existing.is_custom) return c;
  if (!c.is_custom && existing.is_custom) return existing;
  if (existing.is_custom && c.is_custom) return pickManualIdCanonicalWinner(existing, c);
  return pickTrimDuplicateCardRow(existing, c);
}
