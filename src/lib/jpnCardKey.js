/**
 * Shared canonical key for Japanese card deduplication across origins.
 *
 * buildJpnCardKey(setId, number) → lower(set_id) + ':' + normalizeJpnNumber(number)
 *
 * normalizeJpnNumber is the single source of truth for normalizing Japanese
 * card numbers (applied in both JS and Python; parity-tested in CI).
 */

/**
 * Deterministic normalization of a Japanese card number.
 *
 * 1. Convert to string, trim whitespace
 * 2. Uppercase all letters
 * 3. Strip non-alphanumeric/hyphen characters
 * 4. Strip leading zeros from the numeric prefix only; preserve letter prefixes
 * 5. If empty after normalization, use "0"
 */
export function normalizeJpnNumber(number) {
  if (number == null) return "0";
  let s = String(number).trim();
  if (!s) return "0";
  s = s.toUpperCase();
  s = s.replace(/[^A-Z0-9-]/g, "");
  s = s.replace(/^(-?)0+(\d)/, "$1$2"); // strip leading zeros from numeric prefix
  return s || "0";
}

/**
 * Canonical dedupe key for a Japanese card.
 */
export function buildJpnCardKey(setId, number) {
  if (!setId) return null;
  return `${String(setId).toLowerCase().trim()}:${normalizeJpnNumber(number)}`;
}
