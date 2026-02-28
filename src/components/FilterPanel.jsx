/**
 * FilterPanel — Dropdowns and controls for filtering the card list.
 *
 * Includes: supertype dropdown, rarity dropdown, set dropdown (grouped by series),
 * artist filter, evolution line filter, region/generation/color filters,
 * trainer type filter, specialty filter, and sort controls.
 * All filter values are lifted to App.jsx via the onChange callback.
 *
 * Features:
 * - Collapsible filter section with toggle button (collapsed by default)
 * - Sort controls in separate row (always visible)
 */

export default function FilterPanel({ options, filters, onChange, expanded, onToggleExpand, customSources = [] }) {
  // Group sets by series for the dropdown optgroups.
  const setsBySeries = {};
  for (const s of options.sets) {
    if (!setsBySeries[s.series]) setsBySeries[s.series] = [];
    setsBySeries[s.series].push(s);
  }

  // Shared styling for all dropdowns.
  const selectClass =
    "px-3 py-2 border border-gray-300 rounded-lg bg-white text-sm " +
    "focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent";

  const isAll    = filters.source === "";
  const isPocket = filters.source === "Pocket";
  const isCustom = customSources.includes(filters.source);
  const isTCG    = !isAll && !isPocket && !isCustom;

  // Check if any filter is active (for highlight)
  const hasActiveFilters =
    filters.supertype ||
    filters.rarity ||
    filters.set_id ||
    filters.region ||
    filters.generation ||
    filters.color ||
    filters.artist ||
    filters.evolution_line ||
    filters.trainer_type ||
    filters.specialty ||
    filters.element ||
    filters.card_type ||
    filters.stage;

  return (
    <div className="mt-4">
      {/* Toggle button */}
      <button
        onClick={onToggleExpand}
        className={`flex items-center gap-2 text-sm mb-2 transition-colors ${
          hasActiveFilters ? "text-green-600 font-medium" : "text-gray-600"
        } hover:text-gray-800`}
      >
        <svg
          className={`w-4 h-4 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
        {expanded ? "Hide Filters" : "Show Filters"}
        {hasActiveFilters && !expanded && (
          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
            Active
          </span>
        )}
      </button>

      {/* Collapsible filter row */}
      <div
        className={`overflow-hidden transition-all duration-200 ${
          expanded ? "max-h-[500px] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <div className="flex flex-wrap gap-3 items-end pb-3">
          {/* Source filter */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Source
            </label>
            <select
              value={filters.source}
              onChange={(e) => onChange({ source: e.target.value })}
              className={selectClass}
            >
              <option value="">All</option>
              <option value="TCG">TCG</option>
              <option value="Pocket">Pocket</option>
              {customSources.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* ── TCG-only filters ─────────────────────────────────── */}
          {(isTCG || isAll) && (
            <>
              {/* Supertype filter */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Supertype
                </label>
                <select
                  value={filters.supertype}
                  onChange={(e) => onChange({ supertype: e.target.value })}
                  className={selectClass}
                >
                  <option value="">All</option>
                  {options.supertypes.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              {/* Trainer Type filter */}
              {options.trainer_types && options.trainer_types.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    Trainer Type
                  </label>
                  <select
                    value={filters.trainer_type || ""}
                    onChange={(e) => onChange({ trainer_type: e.target.value })}
                    className={selectClass}
                  >
                    <option value="">All</option>
                    {options.trainer_types.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Specialty filter */}
              {options.specialties && options.specialties.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    Specialty
                  </label>
                  <select
                    value={filters.specialty || ""}
                    onChange={(e) => onChange({ specialty: e.target.value })}
                    className={selectClass}
                  >
                    <option value="">All</option>
                    {options.specialties.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}

          {/* ── Custom source filters ────────────────────────────── */}
          {isCustom && (
            <>
              {/* Supertype filter */}
              {options.supertypes && options.supertypes.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    Supertype
                  </label>
                  <select
                    value={filters.supertype || ""}
                    onChange={(e) => onChange({ supertype: e.target.value })}
                    className={selectClass}
                  >
                    <option value="">All</option>
                    {options.supertypes.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Artist filter */}
              {options.artists && options.artists.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    Artist
                  </label>
                  <select
                    value={filters.artist || ""}
                    onChange={(e) => onChange({ artist: e.target.value })}
                    className={selectClass + " max-w-[200px]"}
                  >
                    <option value="">All</option>
                    {options.artists.map((a) => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}

          {/* ── Pocket-only filters ──────────────────────────────── */}
          {isPocket && (
            <>
              {/* Card Type filter */}
              {options.card_types && options.card_types.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    Card Type
                  </label>
                  <select
                    value={filters.card_type || ""}
                    onChange={(e) => onChange({ card_type: e.target.value })}
                    className={selectClass}
                  >
                    <option value="">All</option>
                    {options.card_types.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Element filter */}
              {options.elements && options.elements.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    Element
                  </label>
                  <select
                    value={filters.element || ""}
                    onChange={(e) => onChange({ element: e.target.value })}
                    className={selectClass}
                  >
                    <option value="">All</option>
                    {options.elements.map((el) => (
                      <option key={el} value={el}>
                        {el}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Stage filter */}
              {options.stages && options.stages.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    Stage
                  </label>
                  <select
                    value={filters.stage || ""}
                    onChange={(e) => onChange({ stage: e.target.value })}
                    className={selectClass}
                  >
                    <option value="">All</option>
                    {options.stages.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}

          {/* Rarity filter (shared) */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Rarity
            </label>
            <select
              value={filters.rarity}
              onChange={(e) => onChange({ rarity: e.target.value })}
              className={selectClass}
            >
              <option value="">All</option>
              {options.rarities.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          {/* Set filter — grouped by series using optgroups (shared) */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Set
            </label>
            <select
              value={filters.set_id}
              onChange={(e) => onChange({ set_id: e.target.value })}
              className={selectClass + " max-w-[200px]"}
            >
              <option value="">All Sets</option>
              {Object.entries(setsBySeries).map(([series, sets]) => (
                <optgroup key={series} label={series}>
                  {sets.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {/* ── TCG-only filters (continued) ─────────────────────── */}
          {(isTCG || isAll) && (
            <>
              {/* Artist filter */}
              {options.artists && options.artists.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    Artist
                  </label>
                  <select
                    value={filters.artist || ""}
                    onChange={(e) => onChange({ artist: e.target.value })}
                    className={selectClass + " max-w-[200px]"}
                  >
                    <option value="">All</option>
                    {options.artists.map((a) => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Evolution Line filter */}
              {options.evolution_lines && options.evolution_lines.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    Evolution Line
                  </label>
                  <select
                    value={filters.evolution_line || ""}
                    onChange={(e) => onChange({ evolution_line: e.target.value })}
                    className={selectClass + " max-w-[250px]"}
                  >
                    <option value="">All</option>
                    {options.evolution_lines.map((evo) => {
                      // Parse JSON array and format as "A -> B -> C"
                      try {
                        const arr = JSON.parse(evo);
                        const display = arr.join(" -> ");
                        return (
                          <option key={evo} value={evo}>{display}</option>
                        );
                      } catch {
                        return (
                          <option key={evo} value={evo}>{evo}</option>
                        );
                      }
                    })}
                  </select>
                </div>
              )}

              {/* Region filter */}
              {options.regions && options.regions.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    Pokémon Region
                  </label>
                  <select
                    value={filters.region || ""}
                    onChange={(e) => onChange({ region: e.target.value })}
                    className={selectClass}
                  >
                    <option value="">All</option>
                    {options.regions.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Generation filter */}
              {options.generations && options.generations.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    Generation
                  </label>
                  <select
                    value={filters.generation || ""}
                    onChange={(e) => onChange({ generation: e.target.value })}
                    className={selectClass}
                  >
                    <option value="">All</option>
                    {options.generations.map((g) => (
                      <option key={g} value={g}>
                        Gen {g}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Color filter */}
              {options.colors && options.colors.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    Color
                  </label>
                  <select
                    value={filters.color || ""}
                    onChange={(e) => onChange({ color: e.target.value })}
                    className={selectClass}
                  >
                    <option value="">All</option>
                    {options.colors.map((c) => (
                      <option key={c} value={c}>
                        {c.charAt(0).toUpperCase() + c.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Sort row (always visible) */}
      <div className="flex flex-wrap gap-3 items-end border-t border-gray-200 pt-3">
        {/* Sort controls */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            Sort By
          </label>
          <select
            value={filters.sort_by}
            onChange={(e) => onChange({ sort_by: e.target.value })}
            className={selectClass}
          >
            <option value="name">Name</option>
            <option value="number">Number</option>
            {isTCG && <option value="pokedex">Pokedex #</option>}
            <option value="hp">HP</option>
            <option value="rarity">Rarity</option>
            <option value="set_name">Set</option>
            {isTCG && <option value="price">Price</option>}
            {isTCG && <option value="generation">Generation</option>}
            {isTCG && <option value="region">Pokémon Region</option>}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            Order
          </label>
          <select
            value={filters.sort_dir}
            onChange={(e) => onChange({ sort_dir: e.target.value })}
            className={selectClass}
          >
            <option value="asc">A → Z / Low → High</option>
            <option value="desc">Z → A / High → Low</option>
          </select>
        </div>

        {/* Clear all filters button */}
        <button
          onClick={() =>
            onChange({
              supertype: "",
              rarity: "",
              set_id: "",
              region: "",
              generation: "",
              color: "",
              artist: "",
              evolution_line: "",
              trainer_type: "",
              specialty: "",
              element: "",
              card_type: "",
              stage: "",
              sort_by: isTCG ? "pokedex" : "name",
              sort_dir: "asc",
            })
          }
          className="px-3 py-2 text-sm text-green-600 hover:text-green-800
                     hover:bg-green-50 rounded-lg transition-colors"
        >
          Clear Filters
        </button>
      </div>
    </div>
  );
}
