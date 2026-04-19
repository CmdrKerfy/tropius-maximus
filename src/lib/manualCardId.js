/**
 * Canonical manual card id — must stay in sync with Postgres `generate_card_id`
 * (`supabase/migrations/001_create_cards.sql`, updated by `016_generate_card_id_manual.sql`).
 *
 * Format: `custom-{lowercase trimmed set id}-{card number with leading zeros stripped}`
 *
 * Any change here must be mirrored in SQL (LTRIM leading `0` from number, empty → `0`).
 */

/** Same normalization as Postgres uses for the number segment of `generate_card_id`. */
export function normalizeCardNumberForStorage(raw) {
  const rawNum = String(raw ?? "").trim();
  return rawNum.replace(/^0+/, "") || "0";
}

export function buildManualCardId(setId, number) {
  const normalizedSet = String(setId ?? "").trim().toLowerCase();
  if (!normalizedSet) {
    throw new Error("Set ID is required to build a card ID.");
  }
  const normalizedNumber = normalizeCardNumberForStorage(number);
  return `custom-${normalizedSet}-${normalizedNumber}`;
}
