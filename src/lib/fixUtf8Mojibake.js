/**
 * Fix UTF-8 mojibake: text that was read as Latin-1 / Windows-1252 (or similar)
 * and sometimes re-encoded multiple times. Typical sign is the substring "Ã"
 * (UTF-8 continuation bytes shown as Latin-1 pairs).
 */

function decodeMisreadUtf8AsLatin1(s) {
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 255) return null;
    bytes[i] = c;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

/** Classic mojibake markers when UTF-8 was read as Latin-1 (byte 0x83 appears in deep layers). */
function hasMojibakeMarkers(s) {
  return /[\u00c3\u00c2\u0083]/.test(s);
}

/**
 * Double (or more) UTF-8 mis-read often inserts `\u00c3\u00c2` "glue" before the
 * second Latin-1 byte (shown as U+00A9 ©) of a two-byte UTF-8 character — e.g.
 * `PokÃÂÃÂ©mon` for `Pokémon`. Collapse those runs to a single lead `\u00c3`.
 */
function collapseC3C2BeforeA9(s) {
  return s.replace(/(\u00c3\u00c2)+(?=\u00a9)/g, "\u00c3");
}

/**
 * Repeatedly Latin-1 → UTF-8 decode while mojibake markers remain. Stops before
 * decoding a clean string like "é" again (which would corrupt). Caller must
 * pass a substring whose code units are all ≤ U+00FF.
 */
function repairLatin1MojibakeRun(t) {
  if (!hasMojibakeMarkers(t)) return t;
  let cur = t;
  for (let i = 0; i < 40; i++) {
    if (!hasMojibakeMarkers(cur)) break;
    cur = collapseC3C2BeforeA9(cur);
    const next = decodeMisreadUtf8AsLatin1(cur);
    if (next == null || next === cur) break;
    cur = next;
  }
  return cur;
}

/**
 * Unwind one or more "UTF-8 bytes shown as Latin-1 characters" layers.
 * Repairs only runs of BMP code points ≤ U+00FF so ASCII + mojibake in one note
 * does not cross-decode with real Unicode (emoji, CJK) in the same string.
 */
export function repairUtf8Mojibake(s) {
  if (s == null || typeof s !== "string" || s.length === 0) return s;
  if (!hasMojibakeMarkers(s)) return s;

  let out = "";
  let latinRun = "";
  const flushLatin = () => {
    if (latinRun) {
      out += repairLatin1MojibakeRun(latinRun);
      latinRun = "";
    }
  };

  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp <= 255) latinRun += ch;
    else {
      flushLatin();
      out += ch;
    }
  }
  flushLatin();
  return out;
}

/** Remaining single-layer Latin-1–as–UTF-8 artifacts after {@link repairUtf8Mojibake}. */
export function fixLegacyMojibakeReplacements(s) {
  if (!s || typeof s !== "string") return s;
  return s
    .replace(/Ã©/g, "é")
    .replace(/Ã‰/g, "É")
    .replace(/Ã /g, "à")
    .replace(/Ã€/g, "À")
    .replace(/Ã¨/g, "è")
    .replace(/Ã‡/g, "Ç")
    .replace(/Ã§/g, "ç")
    .replace(/Ã¢/g, "â")
    .replace(/Ã®/g, "î")
    .replace(/Ã´/g, "ô")
    .replace(/Ã»/g, "û")
    .replace(/Ã¹/g, "ù")
    .replace(/Ã¯/g, "ï")
    .replace(/Ã«/g, "ë")
    .replace(/Ã¼/g, "ü")
    .replace(/Ã±/g, "ñ")
    .replace(/Ã‘/g, "Ñ")
    .replace(/Ã¸/g, "ø")
    .replace(/Ã˜/g, "Ø")
    .replace(/Ã¥/g, "å")
    .replace(/Ã…/g, "Å");
}

/** Use for any user-visible API string (flavor text, rules, etc.). */
export function fixDisplayText(s) {
  if (s == null) return s;
  if (typeof s !== "string") return s;
  return fixLegacyMojibakeReplacements(repairUtf8Mojibake(s));
}

/**
 * Shallow-fix prose fields on a TCG `raw_data` object (PostgREST JSON).
 * Call on a **copy** of `raw_data` so TanStack Query cache is not mutated.
 */
export function sanitizeCardRawDataForDisplay(raw) {
  if (!raw || typeof raw !== "object") return raw;
  const out = { ...raw };
  const ft = out.flavorText ?? out.flavor_text;
  if (typeof ft === "string") {
    const fixed = fixDisplayText(ft);
    out.flavorText = fixed;
    if ("flavor_text" in out) out.flavor_text = fixed;
  }
  if (Array.isArray(out.rules)) {
    out.rules = out.rules.map((r) => (typeof r === "string" ? fixDisplayText(r) : r));
  }
  if (Array.isArray(out.abilities)) {
    out.abilities = out.abilities.map((ab) =>
      ab && typeof ab === "object"
        ? {
            ...ab,
            name: typeof ab.name === "string" ? fixDisplayText(ab.name) : ab.name,
            text: typeof ab.text === "string" ? fixDisplayText(ab.text) : ab.text,
          }
        : ab
    );
  }
  if (Array.isArray(out.attacks)) {
    out.attacks = out.attacks.map((atk) =>
      atk && typeof atk === "object"
        ? {
            ...atk,
            name: typeof atk.name === "string" ? fixDisplayText(atk.name) : atk.name,
            text: typeof atk.text === "string" ? fixDisplayText(atk.text) : atk.text,
          }
        : atk
    );
  }
  return out;
}
