/**
 * Which Explore filter controls actually affect `fetchCards` for the current
 * data backend and Source. Used to disable / gray out the rest.
 */

/** @typedef {'supabase' | 'duckdb'} DataBackend */

/**
 * @param {string} source - filters.source ("", "TCG", "Pocket", "Custom")
 * @param {DataBackend} backend
 * @returns {Record<string, boolean>} true = filter affects the query
 */
export function getExploreFilterAvailability(source, backend) {
  const s = source ?? "";

  // Source "All" — enable every control (semantics depend on backend; UI stays consistent).
  if (s === "") {
    return {
      set_id: true,
      supertype: true,
      rarity: true,
      artist: true,
      region: true,
      background_pokemon: true,
      evolution_line: true,
      specialty: true,
      weather: true,
      environment: true,
      actions: true,
      pose: true,
    };
  }

  if (backend === "supabase") {
    // Match `fetchCards` in appAdapter (cards.* + annotations.* + subtypes).
    if (s === "Pocket") {
      return {
        set_id: true,
        rarity: true,
        artist: true,
        background_pokemon: true,
        region: true,
        weather: true,
        environment: true,
        actions: true,
        pose: true,
        specialty: true,
        supertype: false,
        evolution_line: false,
      };
    }
    if (s === "Custom") {
      return {
        set_id: true,
        supertype: true,
        rarity: true,
        artist: true,
        evolution_line: true,
        region: true,
        background_pokemon: true,
        specialty: true,
        weather: true,
        environment: true,
        actions: true,
        pose: true,
      };
    }
    return {
      set_id: true,
      supertype: true,
      rarity: true,
      artist: true,
      evolution_line: true,
      region: true,
      background_pokemon: true,
      specialty: true,
      weather: true,
      environment: true,
      actions: true,
      pose: true,
    };
  }

  // DuckDB fetchCards
  if (s === "Pocket") {
    return {
      set_id: true,
      rarity: true,
      artist: true,
      background_pokemon: true,
      supertype: false,
      region: false,
      evolution_line: false,
      specialty: false,
      weather: false,
      environment: false,
      actions: false,
      pose: false,
    };
  }

  if (s === "Custom") {
    return {
      set_id: true,
      supertype: true,
      rarity: true,
      artist: true,
      background_pokemon: true,
      weather: true,
      environment: true,
      actions: true,
      pose: true,
      region: false,
      evolution_line: false,
      specialty: false,
    };
  }

  // "TCG" or unknown — full tcg_cards path uses these columns
  return {
    set_id: true,
    supertype: true,
    rarity: true,
    artist: true,
    region: true,
    background_pokemon: true,
    evolution_line: true,
    specialty: true,
    weather: true,
    environment: true,
    actions: true,
    pose: true,
  };
}

/** Title for disabled controls (concise for native tooltip). */
export function exploreFilterDisabledTitle(backend, source = "") {
  if (!source) return "";
  if (backend === "supabase") {
    return "Not applied in Supabase browse yet for this Source.";
  }
  if (source === "Pocket") {
    return "This filter does not apply to Pocket cards in this database view.";
  }
  if (source === "Custom") {
    return "This filter does not apply to custom cards in this view.";
  }
  return "This filter does not apply to the current Source.";
}
