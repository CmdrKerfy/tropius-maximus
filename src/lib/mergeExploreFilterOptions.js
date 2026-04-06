/**
 * Merge per-source filter option payloads so Explore can show one stable filter bar
 * while the Source control still scopes the card query.
 */

function normalizeSupertypeDisplay(s) {
  if (!s || typeof s !== "string") return s;
  const norm = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (norm === "pokemon") return "Pokémon";
  const alphaOnly = s.replace(/[^a-zA-Z]/g, "").toLowerCase();
  if (alphaOnly === "pokemon" || alphaOnly === "pokmon") return "Pokémon";
  return s;
}

function mergeSupertypes(arr) {
  const seen = new Set();
  return arr
    .map((s) => normalizeSupertypeDisplay(s))
    .filter((s) => {
      if (seen.has(s)) return false;
      seen.add(s);
      return true;
    });
}

function localeSort(a, b) {
  return String(a).localeCompare(String(b), undefined, { sensitivity: "base" });
}

function mergeSetsById(lists) {
  const byId = new Map();
  for (const list of lists) {
    for (const s of list || []) {
      if (s && s.id != null && s.id !== "" && !byId.has(s.id)) byId.set(s.id, s);
    }
  }
  return [...byId.values()].sort((a, b) => {
    const ser = localeSort(a.series || "", b.series || "");
    if (ser !== 0) return ser;
    return localeSort(a.name || "", b.name || "");
  });
}

function uniqSorted(arr) {
  return [...new Set((arr || []).filter((x) => x != null && String(x).trim() !== ""))].sort(localeSort);
}

/**
 * @param {Record<string, unknown>} tcg - fetchFilterOptions("TCG")
 * @param {Record<string, unknown>} pocket - fetchFilterOptions("Pocket")
 * @param {Record<string, unknown>} custom - fetchFilterOptions("Custom")
 */
export function mergeExploreFilterOptions(tcg, pocket, custom) {
  const t = tcg || {};
  const p = pocket || {};
  const c = custom || {};

  return {
    supertypes: mergeSupertypes([
      ...(t.supertypes || []),
      ...(p.supertypes || []),
      ...(c.supertypes || []),
    ]),
    rarities: uniqSorted([...(t.rarities || []), ...(p.rarities || []), ...(c.rarities || [])]),
    sets: mergeSetsById([t.sets, p.sets, c.sets]),
    regions: t.regions || [],
    generations: t.generations || [],
    colors: t.colors || [],
    artists: uniqSorted([...(t.artists || []), ...(p.artists || []), ...(c.artists || [])]),
    evolution_lines: t.evolution_lines || [],
    trainer_types: t.trainer_types || [],
    specialties: t.specialties || [],
    background_pokemon: uniqSorted([
      ...(t.background_pokemon || []),
      ...(p.background_pokemon || []),
      ...(c.background_pokemon || []),
    ]),
    card_types: p.card_types || [],
    elements: p.elements || [],
    stages: p.stages || [],
    weathers: t.weathers || [],
    environments: t.environments || [],
    actions: t.actions || [],
    poses: t.poses || [],
  };
}
