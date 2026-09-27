/**
 * Display label for a card's set: its name, or the set code when no name is recorded
 * (all ptcgdb Japanese cards and Pocket cards as of 2026-09-27). Display-only — never
 * stored, so a real name replaces it as soon as one is published.
 *
 * @param {{ setName?: unknown, setId?: unknown }} parts
 * @returns {{ label: string, named: boolean }}
 */
export function cardSetLabel({ setName, setId } = {}) {
  const name = setName == null ? "" : String(setName).trim();
  if (name) return { label: name, named: true };
  const code = setId == null ? "" : String(setId).trim();
  return { label: code.toUpperCase(), named: false };
}

/** "Name (Series) · #040", skipping empty parts (no stray "()" when the series is missing). */
export function cardSetLine({ setName, setId, series, number } = {}) {
  const { label } = cardSetLabel({ setName, setId });
  const seriesText = series == null ? "" : String(series).trim();
  const numberText = number == null ? "" : String(number).trim();
  const parts = [];
  if (label) parts.push(seriesText ? `${label} (${seriesText})` : label);
  if (numberText) parts.push(`#${numberText}`);
  return parts.join(" · ");
}
