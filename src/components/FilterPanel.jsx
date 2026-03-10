/**
 * FilterPanel — Single flex-wrap row of filter dropdowns + sort controls.
 */

import { useState, useEffect, useRef } from "react";

function MultiSelectDropdown({ options, values, onChange, className = "", groups = null, searchable = true }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef(null);
  const searchRef = useRef(null);

  useEffect(() => {
    if (!open) { setSearch(""); return; }
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    if (searchable) setTimeout(() => searchRef.current?.focus(), 0);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const getVal = (o) => (o && typeof o === "object" ? o.value : o);
  const getLabel = (o) => (o && typeof o === "object" ? o.label : o);

  const toggle = (val) =>
    onChange(values.includes(val) ? values.filter((v) => v !== val) : [...values.filter((v) => v !== val), val]);

  const findLabel = (val) => {
    if (groups) {
      for (const g of groups) {
        const s = g.sets.find((s) => s.id === val);
        if (s) return s.name;
      }
      return val;
    }
    const opt = options?.find((o) => getVal(o) === val);
    return opt ? getLabel(opt) : val;
  };

  const displayText =
    values.length === 0 ? "All" :
    values.length === 1 ? findLabel(values[0]) :
    `${values.length} selected`;

  const isActive = values.length > 0;

  const btnCls =
    "h-10 px-3 py-2 border rounded-lg bg-white text-sm text-left flex items-center gap-1.5 min-w-0 " +
    "focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent " +
    (isActive ? "border-green-400 text-green-700 " : "border-gray-300 text-gray-900 ") +
    className;

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(!open)} className={btnCls}>
        <span className="flex-1 truncate">{displayText}</span>
        <svg
          className={`w-4 h-4 shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 bg-white border border-gray-200 rounded-lg shadow-lg min-w-full w-max max-w-xs flex flex-col">
          {searchable && (
            <div className="p-2 border-b border-gray-100">
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search..."
                className="w-full px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-green-500"
              />
            </div>
          )}
          <div className="max-h-52 overflow-y-auto">
            {groups
              ? groups.map(({ series, sets }) => {
                  const filtered = sets.filter((s) =>
                    s.name.toLowerCase().includes(search.toLowerCase())
                  );
                  if (filtered.length === 0) return null;
                  return (
                    <div key={series}>
                      <div className="px-3 py-1 text-xs font-semibold text-gray-400 uppercase tracking-wide bg-gray-50 sticky top-0">
                        {series}
                      </div>
                      {filtered.map((s) => (
                        <label key={s.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer text-sm">
                          <input
                            type="checkbox"
                            checked={values.includes(s.id)}
                            onChange={() => toggle(s.id)}
                            className="rounded shrink-0"
                          />
                          <span className="truncate">{s.name}</span>
                        </label>
                      ))}
                    </div>
                  );
                })
              : options
                  .filter((opt) =>
                    getLabel(opt).toLowerCase().includes(search.toLowerCase())
                  )
                  .map((opt) => (
                    <label key={getVal(opt)} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer text-sm">
                      <input
                        type="checkbox"
                        checked={values.includes(getVal(opt))}
                        onChange={() => toggle(getVal(opt))}
                        className="rounded shrink-0"
                      />
                      <span className="truncate">{getLabel(opt)}</span>
                    </label>
                  ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function FilterPanel({ options, filters, onChange, expanded, onToggleExpand }) {
  // Build grouped set list for the Set dropdown.
  const seriesOrder = [];
  const setsBySeries = {};
  for (const s of options.sets) {
    if (!setsBySeries[s.series]) {
      setsBySeries[s.series] = [];
      seriesOrder.push(s.series);
    }
    setsBySeries[s.series].push(s);
  }
  const setGroups = seriesOrder.map((series) => ({ series, sets: setsBySeries[series] }));

  // Parse evolution line JSON arrays into {value, label} objects.
  const evoOptions = (options.evolution_lines || []).map((evo) => {
    try {
      return { value: evo, label: JSON.parse(evo).join(" → ") };
    } catch {
      return { value: evo, label: evo };
    }
  });

  const selectClass =
    "h-10 px-3 py-2 border border-gray-300 rounded-lg bg-white text-sm " +
    "focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent";

  const isTCG = filters.source !== "" && filters.source !== "Pocket" && filters.source !== "Custom";

  const isActive = (val) => (Array.isArray(val) ? val.length > 0 : !!val);
  const hasActiveFilters =
    isActive(filters.supertype) || isActive(filters.rarity) || isActive(filters.set_id) ||
    isActive(filters.region) || isActive(filters.generation) || isActive(filters.artist) ||
    isActive(filters.evolution_line) || isActive(filters.trainer_type) ||
    isActive(filters.specialty) || isActive(filters.background_pokemon) || isActive(filters.element) || isActive(filters.card_type) ||
    isActive(filters.stage) || isActive(filters.weather) || isActive(filters.environment);

  // Build lookup maps for chip labels.
  const setNameById = {};
  for (const { sets } of setGroups) {
    for (const s of sets) setNameById[s.id] = s.name;
  }
  const evoLabelByValue = {};
  for (const opt of evoOptions) evoLabelByValue[opt.value] = opt.label;

  // Build one chip per active filter value.
  const activeChips = [];
  if (filters.source) {
    activeChips.push({ key: `source-${filters.source}`, label: `Source: ${filters.source}`, onRemove: () => onChange({ source: "" }) });
  }
  if (filters.supertype) {
    activeChips.push({ key: `supertype-${filters.supertype}`, label: filters.supertype, onRemove: () => onChange({ supertype: "" }) });
  }
  for (const v of filters.rarity || []) {
    activeChips.push({ key: `rarity-${v}`, label: v, onRemove: () => onChange({ rarity: (filters.rarity || []).filter((x) => x !== v) }) });
  }
  for (const v of filters.set_id || []) {
    activeChips.push({ key: `set-${v}`, label: setNameById[v] || v, onRemove: () => onChange({ set_id: (filters.set_id || []).filter((x) => x !== v) }) });
  }
  for (const v of filters.region || []) {
    activeChips.push({ key: `region-${v}`, label: v, onRemove: () => onChange({ region: (filters.region || []).filter((x) => x !== v) }) });
  }
  for (const v of filters.artist || []) {
    activeChips.push({ key: `artist-${v}`, label: v, onRemove: () => onChange({ artist: (filters.artist || []).filter((x) => x !== v) }) });
  }
  for (const v of filters.specialty || []) {
    activeChips.push({ key: `specialty-${v}`, label: v, onRemove: () => onChange({ specialty: (filters.specialty || []).filter((x) => x !== v) }) });
  }
  for (const v of filters.background_pokemon || []) {
    const label = v.charAt(0).toUpperCase() + v.slice(1);
    activeChips.push({ key: `bgpkmn-${v}`, label: `BG: ${label}`, onRemove: () => onChange({ background_pokemon: (filters.background_pokemon || []).filter((x) => x !== v) }) });
  }
  for (const v of filters.evolution_line || []) {
    activeChips.push({ key: `evo-${v}`, label: evoLabelByValue[v] || v, onRemove: () => onChange({ evolution_line: (filters.evolution_line || []).filter((x) => x !== v) }) });
  }
  for (const v of filters.weather || []) {
    activeChips.push({ key: `weather-${v}`, label: v, onRemove: () => onChange({ weather: (filters.weather || []).filter((x) => x !== v) }) });
  }
  for (const v of filters.environment || []) {
    activeChips.push({ key: `environment-${v}`, label: v, onRemove: () => onChange({ environment: (filters.environment || []).filter((x) => x !== v) }) });
  }
  for (const v of filters.actions || []) {
    activeChips.push({ key: `actions-${v}`, label: v, onRemove: () => onChange({ actions: (filters.actions || []).filter((x) => x !== v) }) });
  }
  for (const v of filters.pose || []) {
    activeChips.push({ key: `pose-${v}`, label: v, onRemove: () => onChange({ pose: (filters.pose || []).filter((x) => x !== v) }) });
  }

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
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
        {expanded ? "Hide Filters" : "Show Filters"}
        {hasActiveFilters && !expanded && (
          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Active</span>
        )}
      </button>

      {/* Active filter chips */}
      {activeChips.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1 mb-2">
          {activeChips.map(({ key, label, onRemove }) => (
            <span
              key={key}
              className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-800 text-xs rounded-full border border-green-200"
            >
              <span className="truncate max-w-[160px]">{label}</span>
              <button
                type="button"
                onClick={onRemove}
                className="shrink-0 ml-0.5 text-green-600 hover:text-green-900 leading-none"
                aria-label={`Remove ${label}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Collapsible filter rows */}
      <div
        className={`transition-all duration-200 ${
          expanded ? "max-h-screen opacity-100 overflow-visible" : "max-h-0 opacity-0 overflow-hidden"
        }`}
      >
        {/* Filter dropdowns — grid for column alignment (7 cols = 2 rows when all filters present) */}
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 gap-x-6 gap-y-4 pb-4">
          <div className="flex flex-col min-w-0">
            <label className="block text-xs font-medium text-gray-500 mb-1 shrink-0">Source</label>
            <select
              value={filters.source}
              onChange={(e) => onChange({ source: e.target.value })}
              className={selectClass}
            >
              <option value="">All</option>
              <option value="TCG">TCG</option>
              <option value="Pocket">Pocket</option>
              <option value="Custom">Custom Cards</option>
            </select>
          </div>

          {options.sets?.length > 0 && (
            <div className="flex flex-col min-w-0">
              <label className="block text-xs font-medium text-gray-500 mb-1 shrink-0">Set</label>
              <MultiSelectDropdown
                groups={setGroups}
                values={filters.set_id || []}
                onChange={(v) => onChange({ set_id: v })}
                className="w-full min-w-0"
              />
            </div>
          )}

          {options.artists?.length > 0 && (
            <div className="flex flex-col min-w-0">
              <label className="block text-xs font-medium text-gray-500 mb-1 shrink-0">Artist</label>
              <MultiSelectDropdown
                options={options.artists}
                values={filters.artist || []}
                onChange={(v) => onChange({ artist: v })}
                className="w-full min-w-0"
              />
            </div>
          )}

          {options.supertypes?.length > 0 && (
            <div className="flex flex-col min-w-0">
              <label className="block text-xs font-medium text-gray-500 mb-1 shrink-0">Supertype</label>
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

          {options.regions?.length > 0 && (
            <div className="flex flex-col min-w-0">
              <label className="block text-xs font-medium text-gray-500 mb-1 shrink-0">Featured Region</label>
              <MultiSelectDropdown
                options={options.regions}
                values={filters.region || []}
                onChange={(v) => onChange({ region: v })}
                searchable={false}
                className="w-full min-w-0"
              />
            </div>
          )}

          {options.background_pokemon?.length > 0 && (
            <div className="flex flex-col min-w-0">
              <label className="block text-xs font-medium text-gray-500 mb-1 shrink-0">Background Pokémon</label>
              <MultiSelectDropdown
                options={(options.background_pokemon || []).map((v) => ({
                  value: v,
                  label: v.charAt(0).toUpperCase() + v.slice(1),
                }))}
                values={filters.background_pokemon || []}
                onChange={(v) => onChange({ background_pokemon: v })}
                className="w-full min-w-0"
              />
            </div>
          )}

          {evoOptions.length > 0 && (
            <div className="flex flex-col min-w-0">
              <label className="block text-xs font-medium text-gray-500 mb-1 shrink-0">Evolution Line</label>
              <MultiSelectDropdown
                options={evoOptions}
                values={filters.evolution_line || []}
                onChange={(v) => onChange({ evolution_line: v })}
                className="w-full min-w-0"
              />
            </div>
          )}

          {options.rarities?.length > 0 && (
            <div className="flex flex-col min-w-0">
              <label className="block text-xs font-medium text-gray-500 mb-1 shrink-0">Rarity</label>
              <MultiSelectDropdown
                options={options.rarities}
                values={filters.rarity || []}
                onChange={(v) => onChange({ rarity: v })}
                className="w-full min-w-0"
              />
            </div>
          )}

          {options.specialties?.length > 0 && (
            <div className="flex flex-col min-w-0">
              <label className="block text-xs font-medium text-gray-500 mb-1 shrink-0">Specialty</label>
              <MultiSelectDropdown
                options={options.specialties}
                values={filters.specialty || []}
                onChange={(v) => onChange({ specialty: v })}
                className="w-full min-w-0"
              />
            </div>
          )}

          {options.weathers?.length > 0 && (
            <div className="flex flex-col min-w-0">
              <label className="block text-xs font-medium text-gray-500 mb-1 shrink-0">Weather</label>
              <MultiSelectDropdown
                options={options.weathers}
                values={filters.weather || []}
                onChange={(v) => onChange({ weather: v })}
                className="w-full min-w-0"
              />
            </div>
          )}

          {options.environments?.length > 0 && (
            <div className="flex flex-col min-w-0">
              <label className="block text-xs font-medium text-gray-500 mb-1 shrink-0">Environment</label>
              <MultiSelectDropdown
                options={options.environments}
                values={filters.environment || []}
                onChange={(v) => onChange({ environment: v })}
                className="w-full min-w-0"
              />
            </div>
          )}

          {options.actions?.length > 0 && (
            <div className="flex flex-col min-w-0">
              <label className="block text-xs font-medium text-gray-500 mb-1 shrink-0">Action</label>
              <MultiSelectDropdown
                options={options.actions}
                values={filters.actions || []}
                onChange={(v) => onChange({ actions: v })}
                className="w-full min-w-0"
              />
            </div>
          )}

          {options.poses?.length > 0 && (
            <div className="flex flex-col min-w-0">
              <label className="block text-xs font-medium text-gray-500 mb-1 shrink-0">Pose</label>
              <MultiSelectDropdown
                options={options.poses}
                values={filters.pose || []}
                onChange={(v) => onChange({ pose: v })}
                className="w-full min-w-0"
              />
            </div>
          )}
        </div>
      </div>

      {/* Sort row (always visible) */}
      <div className="flex flex-wrap gap-3 items-start border-t border-gray-200 pt-3">
        <div className="flex flex-col">
          <label className="block text-xs font-medium text-gray-500 mb-1 shrink-0">Sort By</label>
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
            {isTCG && <option value="region">Featured Region</option>}
          </select>
        </div>

        <div className="flex flex-col">
          <label className="block text-xs font-medium text-gray-500 mb-1 shrink-0">Order</label>
          <select
            value={filters.sort_dir}
            onChange={(e) => onChange({ sort_dir: e.target.value })}
            className={selectClass}
          >
            <option value="asc">A → Z / Low → High</option>
            <option value="desc">Z → A / High → Low</option>
          </select>
        </div>

        <div className="flex flex-col">
          <span className="block text-xs mb-1 invisible select-none" aria-hidden="true">Sort</span>
          <button
            onClick={() =>
              onChange({
                supertype: "",
                rarity: [],
                set_id: [],
                region: [],
                generation: "",
                color: "",
                artist: [],
                evolution_line: [],
                trainer_type: "",
                specialty: [],
                background_pokemon: [],
                element: [],
                card_type: [],
                stage: [],
                weather: [],
                environment: [],
                actions: [],
                pose: [],
                sort_by: isTCG ? "pokedex" : "name",
                sort_dir: "asc",
              })
            }
            className="h-10 px-3 py-2 text-sm text-green-600 hover:text-green-800 hover:bg-green-50 rounded-lg transition-colors flex items-center"
          >
            Clear Filters
          </button>
        </div>
      </div>
    </div>
  );
}
