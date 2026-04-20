import { fixDisplayText } from "./fixUtf8Mojibake.js";

export function formatEvolutionLineLabel(raw) {
  if (raw == null) return "";
  const src = fixDisplayText(String(raw).trim());
  if (!src) return "";
  try {
    const parsed = JSON.parse(src);
    if (Array.isArray(parsed)) {
      const parts = parsed
        .map((x) => fixDisplayText(String(x ?? "").trim()))
        .filter(Boolean);
      return parts.join(" -> ");
    }
  } catch {
    // not JSON
  }
  return src.replace(/\s*(?:→|->)\s*/g, " -> ").replace(/\s+/g, " ").trim();
}

export function normalizeEvolutionLineOptions(options) {
  const arr = Array.isArray(options) ? options : [];
  const seen = new Set();
  const out = [];
  for (const raw of arr) {
    const label = formatEvolutionLineLabel(raw);
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}
