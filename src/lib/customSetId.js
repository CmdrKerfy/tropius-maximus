/**
 * Set IDs for custom (manual) TCG cards.
 *
 * The Add Card form used to derive the Set ID from the Set Name's initials only
 * ("Bulbasaur Deck" → "bd"). Short codes like that are what the card sources use,
 * so 13 manual cards landed in PTCG-db's Japanese set `bd` ("Battle Starter Deck
 * (Torterra)") without any warning. `resolveCustomSetId` now reuses an existing
 * custom set with the same name, and never derives an ID that a differently named
 * set already owns.
 *
 * `sets` rows are `{ id, name, origin }` from the `sets` table.
 */

const CUSTOM_PREFIX = "custom-";

function normName(name) {
  return String(name ?? "").trim().toLowerCase();
}

/** Legacy acronym: first letter of each word + whole-number words ("Test Set Name, Set 4" → "tsns4"). */
export function acronymSetId(setName) {
  return String(setName ?? "")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (/^\d+$/.test(w) ? w : w[0]))
    .join("")
    .toLowerCase();
}

/** "Bulbasaur Deck" → "custom-bulbasaur-deck" ("" when the name has no letters or digits). */
export function slugSetId(setName) {
  const slug = String(setName ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `${CUSTOM_PREFIX}${slug}` : "";
}

function indexSets(sets) {
  const byId = new Map();
  for (const s of sets || []) {
    if (s && s.id != null) byId.set(String(s.id), s);
  }
  return byId;
}

/**
 * The Set ID a custom card with this Set Name should use.
 *
 * 1. An existing custom set with the same name (case-insensitive) → its ID
 *    (the acronym one when several share the name, matching the old behavior).
 * 2. Else the acronym, unless a set with a different name already owns it.
 * 3. Else "custom-{slug}", suffixed "-2", "-3", … past any taken ID.
 *
 * @returns {{ setId: string, existing: boolean }}  existing: reuses a custom set
 */
export function resolveCustomSetId(setName, sets) {
  const name = normName(setName);
  const acronym = acronymSetId(setName);
  if (!name || !acronym) return { setId: acronym, existing: false };
  const byId = indexSets(sets);

  const sameName = [...byId.values()]
    .filter((s) => s.origin === "manual" && normName(s.name) === name)
    .map((s) => String(s.id))
    .sort();
  if (sameName.length) {
    return { setId: sameName.includes(acronym) ? acronym : sameName[0], existing: true };
  }

  const takenByOther = (id) => {
    const s = byId.get(id);
    return Boolean(s) && normName(s.name) !== name;
  };
  if (!takenByOther(acronym)) return { setId: acronym, existing: false };

  const base = slugSetId(setName);
  let candidate = base;
  for (let n = 2; takenByOther(candidate); n += 1) candidate = `${base}-${n}`;
  return { setId: candidate, existing: false };
}

/**
 * The existing set this Set ID belongs to when its name differs from `setName`
 * (the card would be listed under that other set), else null.
 */
export function setIdConflict(setId, setName, sets) {
  const id = String(setId ?? "").trim();
  if (!id) return null;
  const s = indexSets(sets).get(id);
  if (!s || normName(s.name) === normName(setName)) return null;
  return { id, name: s.name || id, origin: s.origin || "" };
}

const ORIGIN_LABELS = {
  "pokemontcg.io": "English TCG",
  tcgdex: "TCGdex",
  ptcgdb: "Japanese PTCG-db",
  manual: "custom",
};

export function setOriginLabel(origin) {
  return ORIGIN_LABELS[origin] || origin || "unknown source";
}
