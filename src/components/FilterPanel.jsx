/**
 * FilterPanel — Dropdowns and controls for filtering the card list.
 *
 * Includes: supertype dropdown, type dropdown (with variant grouping),
 * rarity dropdown, set dropdown (grouped by series), HP range,
 * artist filter, evolution line filter, region/generation/color filters,
 * and sort controls.
 * All filter values are lifted to App.jsx via the onChange callback.
 *
 * Features:
 * - Collapsible filter section with toggle button
 * - Type variants (e.g., "Darkness" vs quoted variants) grouped in optgroups
 * - Sort controls in separate row (always visible)
 */

import { useMemo } from "react";

export default function FilterPanel({ options, filters, onChange, expanded, onToggleExpand }) {
  // Group sets by series for the dropdown optgroups.
  const setsBySeries = {};
  for (const s of options.sets) {
    if (!setsBySeries[s.series]) setsBySeries[s.series] = [];
    setsBySeries[s.series].push(s);
  }

  // Group types with their quoted variants
  const groupedTypes = useMemo(() => {
    const groups = {};
    for (const t of options.types) {
      // Strip quotes to get base type name
      const base = t.replace(/^"|"$/g, "");
      if (!groups[base]) groups[base] = [];
      groups[base].push(t);
    }
    return groups;
  }, [options.types]);

  // Shared styling for all dropdowns.
  const selectClass =
    "px-3 py-2 border border-gray-300 rounded-lg bg-white text-sm " +
    "focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent";

  const inputClass =
    "w-20 px-2 py-2 border border-gray-300 rounded-lg bg-white text-sm " +
    "focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent";

  // Check if any filter is active (for highlight)
  const hasActiveFilters =
    filters.supertype ||
    filters.types ||
    filters.rarity ||
    filters.set_id ||
    filters.hp_min > 0 ||
    filters.hp_max > 0 ||
    filters.region ||
    filters.generation ||
    filters.color ||
    filters.artist ||
    filters.evolution_line;

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

          {/* Type filter with grouping */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Type
            </label>
            <select
              value={filters.types}
              onChange={(e) => onChange({ types: e.target.value })}
              className={selectClass}
            >
              <option value="">All</option>
              {Object.entries(groupedTypes).map(([base, variants]) =>
                variants.length === 1 ? (
                  <option key={base} value={variants[0]}>
                    {base}
                  </option>
                ) : (
                  <optgroup key={base} label={base}>
                    {variants.map((v) => (
                      <option key={v} value={v}>
                        {v === base ? base : `${base} (alt)`}
                      </option>
                    ))}
                  </optgroup>
                )
              )}
            </select>
          </div>

          {/* Rarity filter */}
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

          {/* Set filter — grouped by series using optgroups */}
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

          {/* HP range */}
          <div className="flex items-end gap-1">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                HP Min
              </label>
              <input
                type="number"
                min="0"
                value={filters.hp_min || ""}
                onChange={(e) =>
                  onChange({ hp_min: parseInt(e.target.value) || 0 })
                }
                placeholder="0"
                className={inputClass}
              />
            </div>
            <span className="pb-2 text-gray-400">–</span>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                HP Max
              </label>
              <input
                type="number"
                min="0"
                value={filters.hp_max || ""}
                onChange={(e) =>
                  onChange({ hp_max: parseInt(e.target.value) || 0 })
                }
                placeholder="Any"
                className={inputClass}
              />
            </div>
          </div>

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
                Region
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
            <option value="pokedex">Pokedex #</option>
            <option value="hp">HP</option>
            <option value="rarity">Rarity</option>
            <option value="set_name">Set</option>
            <option value="price">Price</option>
            <option value="generation">Generation</option>
            <option value="region">Region</option>
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
              types: "",
              rarity: "",
              set_id: "",
              hp_min: 0,
              hp_max: 0,
              region: "",
              generation: "",
              color: "",
              artist: "",
              evolution_line: "",
              sort_by: "name",
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
