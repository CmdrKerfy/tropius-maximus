/**
 * Split a field label into a primary line and an optional secondary line.
 * Handles long labels and parenthetical hints, e.g. "Berries (if present)".
 *
 * Rules:
 * 1. Prefer split on `" ("` — common "Title (hint)" pattern.
 * 2. Else split on first `(` if it is not the first character.
 * 3. Otherwise return the full string as primary.
 */
export function splitUiLabel(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return { primary: "", secondary: null };

  const spaced = s.indexOf(" (");
  if (spaced > 0) {
    return {
      primary: s.slice(0, spaced).trim(),
      secondary: s.slice(spaced + 1).trim(),
    };
  }

  const p = s.indexOf("(");
  if (p > 0) {
    return {
      primary: s.slice(0, p).trim(),
      secondary: s.slice(p).trim(),
    };
  }

  return { primary: s, secondary: null };
}
