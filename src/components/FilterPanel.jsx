/**
 * FilterPanel — Explore filters + sort (Phase 4: summary, primary/advanced, mobile sheet).
 */

import { useState, useEffect, useRef, useMemo } from "react";
import { ChevronDown, X } from "lucide-react";
import Button from "./ui/Button.jsx";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "./ui/Dialog.jsx";
import { useMediaQuery } from "../lib/useMediaQuery.js";
import { exploreFiltersAreActive } from "../lib/exploreFilterSummary.js";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/DropdownMenu.jsx";

const UNCATEGORIZED_HEADER = "Uncategorized";

function seriesBucketKey(seriesRaw) {
  const s = seriesRaw == null ? "" : String(seriesRaw).trim();
  if (!s) return { key: "__none__", header: UNCATEGORIZED_HEADER, sort: 2 };
  return { key: s, header: s, sort: 1 };
}

function MultiSelectDropdown({
  options,
  values,
  onChange,
  className = "",
  groups = null,
  searchable = true,
  disabled = false,
  disabledTitle = "",
}) {
  const [search, setSearch] = useState("");
  const searchRef = useRef(null);

  const getVal = (o) => (o && typeof o === "object" ? o.value : o);
  const getLabel = (o) => (o && typeof o === "object" ? o.label : o);

  const toggle = (val) =>
    onChange(values.includes(val) ? values.filter((v) => v !== val) : [...values.filter((v) => v !== val), val]);

  const findLabel = (val) => {
    if (groups) {
      for (const g of groups) {
        const s = g.sets.find((x) => x.id === val);
        if (s) return s.name;
      }
      return val;
    }
    const opt = options?.find((o) => getVal(o) === val);
    return opt ? getLabel(opt) : val;
  };

  const displayText =
    values.length === 0 ? "All" : values.length === 1 ? findLabel(values[0]) : `${values.length} selected`;

  const isActive = values.length > 0;

  const btnCls =
    "h-10 px-3 py-2 border rounded-lg bg-white text-sm text-left inline-flex items-center gap-1.5 min-w-0 w-full " +
    "focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent " +
    (isActive ? "border-green-400 text-green-700 " : "border-gray-300 text-gray-900 ") +
    (disabled ? "opacity-50 cursor-not-allowed bg-gray-50 text-gray-500 " : "") +
    className;

  const filterText = String(search || "").trim().toLowerCase();
  const optionMatches = (label) => {
    if (!filterText) return true;
    return String(label || "").toLowerCase().includes(filterText);
  };

  return (
    <div className="min-w-0" title={disabled ? disabledTitle : undefined}>
      <DropdownMenu
        onOpenChange={(next) => {
          if (next && searchable) {
            setSearch("");
            setTimeout(() => searchRef.current?.focus(), 0);
          }
          if (!next) setSearch("");
        }}
      >
        <DropdownMenuTrigger asChild>
          <button type="button" disabled={disabled} className={btnCls} aria-label="Choose filter options">
            <span className="flex-1 truncate">{displayText}</span>
            <ChevronDown className="w-4 h-4 shrink-0 text-gray-400" strokeWidth={2} aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="p-0 overflow-hidden">
          {searchable && (
            <div className="p-2 border-b border-gray-100">
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-green-500"
                onKeyDown={(e) => e.stopPropagation()}
              />
            </div>
          )}
          <div className="max-h-[min(18rem,60vh)] overflow-y-auto p-1.5">
            {groups ? (
              groups.map(({ id, header, sets }, idx) => {
                const filtered = sets.filter((s) => optionMatches(s.name));
                if (filtered.length === 0) return null;
                return (
                  <div key={id}>
                    {idx > 0 && <DropdownMenuSeparator />}
                    <div className="px-2.5 py-1 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                      {header}
                    </div>
                    {filtered.map((s) => (
                      <DropdownMenuCheckboxItem
                        key={s.id}
                        checked={values.includes(s.id)}
                        onSelect={(e) => {
                          e.preventDefault();
                          toggle(s.id);
                        }}
                      >
                        <span className="truncate">{s.name}</span>
                      </DropdownMenuCheckboxItem>
                    ))}
                  </div>
                );
              })
            ) : (
              options
                .map((opt) => ({ value: getVal(opt), label: getLabel(opt) }))
                .filter((opt) => optionMatches(opt.label))
                .map((opt) => (
                  <DropdownMenuCheckboxItem
                    key={opt.value}
                    checked={values.includes(opt.value)}
                    onSelect={(e) => {
                      e.preventDefault();
                      toggle(opt.value);
                    }}
                  >
                    <span className="truncate">{opt.label}</span>
                  </DropdownMenuCheckboxItem>
                ))
            )}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

const SORT_LABELS = {
  name: "Name",
  number: "Number",
  pokedex: "Pokédex #",
  hp: "HP",
  rarity: "Rarity",
  set_name: "Set",
  price: "Price",
  region: "Featured region",
};

export default function FilterPanel({
  options,
  filters,
  onChange,
  expanded,
  onToggleExpand,
  filterAvailability,
  filterUnavailableTitle = "",
  searchQuery = "",
  onResetAll,
}) {
  const isLg = useMediaQuery("(min-width: 1024px)");
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    if (isLg) setSheetOpen(false);
  }, [isLg]);

  const isFilterOn = (key) => filterAvailability?.[key] !== false;

  const setGroups = useMemo(() => {
    const byKey = new Map();
    for (const setRow of options.sets || []) {
      const { key, header, sort } = seriesBucketKey(setRow.series);
      if (!byKey.has(key)) {
        byKey.set(key, { id: key, header, sort, sets: [] });
      }
      byKey.get(key).sets.push(setRow);
    }
    for (const g of byKey.values()) {
      g.sets.sort((a, b) =>
        (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" })
      );
    }
    return [...byKey.values()].sort((a, b) => {
      if (a.sort !== b.sort) return a.sort - b.sort;
      return a.header.localeCompare(b.header, undefined, { sensitivity: "base" });
    });
  }, [options.sets]);

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
    isActive(filters.supertype) ||
    isActive(filters.rarity) ||
    isActive(filters.set_id) ||
    isActive(filters.region) ||
    isActive(filters.generation) ||
    isActive(filters.artist) ||
    isActive(filters.evolution_line) ||
    isActive(filters.trainer_type) ||
    isActive(filters.specialty) ||
    isActive(filters.background_pokemon) ||
    isActive(filters.element) ||
    isActive(filters.card_type) ||
    isActive(filters.stage) ||
    isActive(filters.weather) ||
    isActive(filters.environment) ||
    isActive(filters.actions) ||
    isActive(filters.pose);

  const setNameById = {};
  for (const { sets } of setGroups) {
    for (const s of sets) setNameById[s.id] = s.name;
  }
  const evoLabelByValue = {};
  for (const opt of evoOptions) evoLabelByValue[opt.value] = opt.label;

  const activeChips = [];
  if (filters.source) {
    activeChips.push({
      key: `source-${filters.source}`,
      label: `Source: ${filters.source}`,
      onRemove: () => onChange({ source: "" }),
    });
  }
  if (filters.supertype) {
    activeChips.push({
      key: `supertype-${filters.supertype}`,
      label: filters.supertype,
      onRemove: () => onChange({ supertype: "" }),
    });
  }
  for (const v of filters.rarity || []) {
    activeChips.push({
      key: `rarity-${v}`,
      label: v,
      onRemove: () => onChange({ rarity: (filters.rarity || []).filter((x) => x !== v) }),
    });
  }
  for (const v of filters.set_id || []) {
    activeChips.push({
      key: `set-${v}`,
      label: setNameById[v] || v,
      onRemove: () => onChange({ set_id: (filters.set_id || []).filter((x) => x !== v) }),
    });
  }
  for (const v of filters.region || []) {
    activeChips.push({
      key: `region-${v}`,
      label: v,
      onRemove: () => onChange({ region: (filters.region || []).filter((x) => x !== v) }),
    });
  }
  for (const v of filters.artist || []) {
    activeChips.push({
      key: `artist-${v}`,
      label: v,
      onRemove: () => onChange({ artist: (filters.artist || []).filter((x) => x !== v) }),
    });
  }
  for (const v of filters.specialty || []) {
    activeChips.push({
      key: `specialty-${v}`,
      label: v,
      onRemove: () => onChange({ specialty: (filters.specialty || []).filter((x) => x !== v) }),
    });
  }
  for (const v of filters.background_pokemon || []) {
    const label = v.charAt(0).toUpperCase() + v.slice(1);
    activeChips.push({
      key: `bgpkmn-${v}`,
      label: `BG: ${label}`,
      onRemove: () => onChange({ background_pokemon: (filters.background_pokemon || []).filter((x) => x !== v) }),
    });
  }
  for (const v of filters.evolution_line || []) {
    activeChips.push({
      key: `evo-${v}`,
      label: evoLabelByValue[v] || v,
      onRemove: () => onChange({ evolution_line: (filters.evolution_line || []).filter((x) => x !== v) }),
    });
  }
  for (const v of filters.weather || []) {
    activeChips.push({
      key: `weather-${v}`,
      label: v,
      onRemove: () => onChange({ weather: (filters.weather || []).filter((x) => x !== v) }),
    });
  }
  for (const v of filters.environment || []) {
    activeChips.push({
      key: `environment-${v}`,
      label: v,
      onRemove: () => onChange({ environment: (filters.environment || []).filter((x) => x !== v) }),
    });
  }
  for (const v of filters.actions || []) {
    activeChips.push({
      key: `actions-${v}`,
      label: v,
      onRemove: () => onChange({ actions: (filters.actions || []).filter((x) => x !== v) }),
    });
  }
  for (const v of filters.pose || []) {
    activeChips.push({
      key: `pose-${v}`,
      label: v,
      onRemove: () => onChange({ pose: (filters.pose || []).filter((x) => x !== v) }),
    });
  }

  const filtersActive = exploreFiltersAreActive(filters);
  const q = String(searchQuery || "").trim();
  const sortLabel = SORT_LABELS[filters.sort_by] || filters.sort_by || "Name";
  const orderLabel = filters.sort_dir === "desc" ? "high → low" : "low → high";
  const sourceLabel = filters.source ? filters.source : "All catalogs";

  const handleClearOrReset = () => {
    if (onResetAll) {
      onResetAll();
      return;
    }
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
      source: "",
    });
  };

  const renderFilterBody = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-x-4 gap-y-4">
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
          <div
            className={`flex flex-col min-w-0 ${!isFilterOn("set_id") ? "opacity-45 saturate-50" : ""}`}
            title={!isFilterOn("set_id") ? filterUnavailableTitle : undefined}
          >
            <label className="block text-xs font-medium text-gray-500 mb-1 shrink-0">Set</label>
            <MultiSelectDropdown
              groups={setGroups}
              values={filters.set_id || []}
              onChange={(v) => onChange({ set_id: v })}
              className="w-full min-w-0"
              disabled={!isFilterOn("set_id")}
              disabledTitle={filterUnavailableTitle}
            />
          </div>
        )}

        {options.supertypes?.length > 0 && (
          <div
            className={`flex flex-col min-w-0 ${!isFilterOn("supertype") ? "opacity-45 saturate-50" : ""}`}
            title={!isFilterOn("supertype") ? filterUnavailableTitle : undefined}
          >
            <label className="block text-xs font-medium text-gray-500 mb-1 shrink-0">Supertype</label>
            <select
              value={filters.supertype || ""}
              onChange={(e) => onChange({ supertype: e.target.value })}
              className={
                selectClass +
                (!isFilterOn("supertype") ? " opacity-50 cursor-not-allowed bg-gray-50 text-gray-600" : "")
              }
              disabled={!isFilterOn("supertype")}
            >
              <option value="">All</option>
              {options.supertypes.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        )}

        {options.rarities?.length > 0 && (
          <div
            className={`flex flex-col min-w-0 ${!isFilterOn("rarity") ? "opacity-45 saturate-50" : ""}`}
            title={!isFilterOn("rarity") ? filterUnavailableTitle : undefined}
          >
            <label className="block text-xs font-medium text-gray-500 mb-1 shrink-0">Rarity</label>
            <MultiSelectDropdown
              options={options.rarities}
              values={filters.rarity || []}
              onChange={(v) => onChange({ rarity: v })}
              className="w-full min-w-0"
              disabled={!isFilterOn("rarity")}
              disabledTitle={filterUnavailableTitle}
            />
          </div>
        )}

        {options.artists?.length > 0 && (
          <div
            className={`flex flex-col min-w-0 ${!isFilterOn("artist") ? "opacity-45 saturate-50" : ""}`}
            title={!isFilterOn("artist") ? filterUnavailableTitle : undefined}
          >
            <label className="block text-xs font-medium text-gray-500 mb-1 shrink-0">Artist</label>
            <MultiSelectDropdown
              options={options.artists}
              values={filters.artist || []}
              onChange={(v) => onChange({ artist: v })}
              className="w-full min-w-0"
              disabled={!isFilterOn("artist")}
              disabledTitle={filterUnavailableTitle}
            />
          </div>
        )}

        {options.regions?.length > 0 && (
          <div
            className={`flex flex-col min-w-0 ${!isFilterOn("region") ? "opacity-45 saturate-50" : ""}`}
            title={!isFilterOn("region") ? filterUnavailableTitle : undefined}
          >
            <label className="block text-xs font-medium text-gray-500 mb-1 shrink-0">Featured Region</label>
            <MultiSelectDropdown
              options={options.regions}
              values={filters.region || []}
              onChange={(v) => onChange({ region: v })}
              searchable={false}
              className="w-full min-w-0"
              disabled={!isFilterOn("region")}
              disabledTitle={filterUnavailableTitle}
            />
          </div>
        )}
      </div>

      <details className="group rounded-lg border border-gray-200 bg-gray-50/60 open:bg-white open:shadow-sm">
        <summary className="cursor-pointer select-none list-none px-3 py-2.5 text-sm font-semibold text-gray-800 flex items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
          <span>More filters</span>
          <span className="text-xs font-normal text-gray-500">Art &amp; scene options</span>
        </summary>
        <div className="px-3 pb-4 pt-1 border-t border-gray-200">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-4">
            {options.background_pokemon?.length > 0 && (
              <div
                className={`flex flex-col min-w-0 ${!isFilterOn("background_pokemon") ? "opacity-45 saturate-50" : ""}`}
                title={!isFilterOn("background_pokemon") ? filterUnavailableTitle : undefined}
              >
                <label className="block text-xs font-medium text-gray-500 mb-1 shrink-0">Background Pokémon</label>
                <MultiSelectDropdown
                  options={(options.background_pokemon || []).map((v) => ({
                    value: v,
                    label: v.charAt(0).toUpperCase() + v.slice(1),
                  }))}
                  values={filters.background_pokemon || []}
                  onChange={(v) => onChange({ background_pokemon: v })}
                  className="w-full min-w-0"
                  disabled={!isFilterOn("background_pokemon")}
                  disabledTitle={filterUnavailableTitle}
                />
              </div>
            )}

            {evoOptions.length > 0 && (
              <div
                className={`flex flex-col min-w-0 ${!isFilterOn("evolution_line") ? "opacity-45 saturate-50" : ""}`}
                title={!isFilterOn("evolution_line") ? filterUnavailableTitle : undefined}
              >
                <label className="block text-xs font-medium text-gray-500 mb-1 shrink-0">Evolution Line</label>
                <MultiSelectDropdown
                  options={evoOptions}
                  values={filters.evolution_line || []}
                  onChange={(v) => onChange({ evolution_line: v })}
                  className="w-full min-w-0"
                  disabled={!isFilterOn("evolution_line")}
                  disabledTitle={filterUnavailableTitle}
                />
              </div>
            )}

            {options.specialties?.length > 0 && (
              <div
                className={`flex flex-col min-w-0 ${!isFilterOn("specialty") ? "opacity-45 saturate-50" : ""}`}
                title={!isFilterOn("specialty") ? filterUnavailableTitle : undefined}
              >
                <label className="block text-xs font-medium text-gray-500 mb-1 shrink-0">Specialty</label>
                <MultiSelectDropdown
                  options={options.specialties}
                  values={filters.specialty || []}
                  onChange={(v) => onChange({ specialty: v })}
                  className="w-full min-w-0"
                  disabled={!isFilterOn("specialty")}
                  disabledTitle={filterUnavailableTitle}
                />
              </div>
            )}

            {options.weathers?.length > 0 && (
              <div
                className={`flex flex-col min-w-0 ${!isFilterOn("weather") ? "opacity-45 saturate-50" : ""}`}
                title={!isFilterOn("weather") ? filterUnavailableTitle : undefined}
              >
                <label className="block text-xs font-medium text-gray-500 mb-1 shrink-0">Weather</label>
                <MultiSelectDropdown
                  options={options.weathers}
                  values={filters.weather || []}
                  onChange={(v) => onChange({ weather: v })}
                  className="w-full min-w-0"
                  disabled={!isFilterOn("weather")}
                  disabledTitle={filterUnavailableTitle}
                />
              </div>
            )}

            {options.environments?.length > 0 && (
              <div
                className={`flex flex-col min-w-0 ${!isFilterOn("environment") ? "opacity-45 saturate-50" : ""}`}
                title={!isFilterOn("environment") ? filterUnavailableTitle : undefined}
              >
                <label className="block text-xs font-medium text-gray-500 mb-1 shrink-0">Environment</label>
                <MultiSelectDropdown
                  options={options.environments}
                  values={filters.environment || []}
                  onChange={(v) => onChange({ environment: v })}
                  className="w-full min-w-0"
                  disabled={!isFilterOn("environment")}
                  disabledTitle={filterUnavailableTitle}
                />
              </div>
            )}

            {options.actions?.length > 0 && (
              <div
                className={`flex flex-col min-w-0 ${!isFilterOn("actions") ? "opacity-45 saturate-50" : ""}`}
                title={!isFilterOn("actions") ? filterUnavailableTitle : undefined}
              >
                <label className="block text-xs font-medium text-gray-500 mb-1 shrink-0">Action</label>
                <MultiSelectDropdown
                  options={options.actions}
                  values={filters.actions || []}
                  onChange={(v) => onChange({ actions: v })}
                  className="w-full min-w-0"
                  disabled={!isFilterOn("actions")}
                  disabledTitle={filterUnavailableTitle}
                />
              </div>
            )}

            {options.poses?.length > 0 && (
              <div
                className={`flex flex-col min-w-0 ${!isFilterOn("pose") ? "opacity-45 saturate-50" : ""}`}
                title={!isFilterOn("pose") ? filterUnavailableTitle : undefined}
              >
                <label className="block text-xs font-medium text-gray-500 mb-1 shrink-0">Pose</label>
                <MultiSelectDropdown
                  options={options.poses}
                  values={filters.pose || []}
                  onChange={(v) => onChange({ pose: v })}
                  className="w-full min-w-0"
                  disabled={!isFilterOn("pose")}
                  disabledTitle={filterUnavailableTitle}
                />
              </div>
            )}
          </div>
        </div>
      </details>
    </div>
  );

  return (
    <div className="mt-4 mb-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2 text-sm text-gray-600">
        <span className="font-semibold text-gray-800">Viewing</span>
        <span className="min-w-0">
          {sourceLabel}
          {q ? (
            <>
              {" "}
              · search “<span className="font-medium text-gray-800">{q}</span>”
            </>
          ) : null}
          {" · "}
          {activeChips.length} filter{activeChips.length === 1 ? "" : "s"}
          {" · "}
          sort: {sortLabel} ({orderLabel})
        </span>
        {(filtersActive || q) && onResetAll && (
          <button
            type="button"
            onClick={onResetAll}
            className="text-tm-leaf font-semibold hover:underline text-sm ml-auto"
          >
            Reset all
          </button>
        )}
      </div>

      {isLg ? (
        <button
          type="button"
          onClick={onToggleExpand}
          className={`flex items-center gap-2 text-sm mb-2 transition-colors ${
            hasActiveFilters ? "text-green-600 font-medium" : "text-gray-600"
          } hover:text-gray-800`}
        >
          <ChevronDown
            className={`w-4 h-4 transition-transform ${expanded ? "rotate-180" : ""}`}
            strokeWidth={2}
            aria-hidden
          />
          {expanded ? "Hide filters" : "Show filters"}
          {hasActiveFilters && !expanded && (
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Active</span>
          )}
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <Button type="button" variant="secondary" size="md" onClick={() => setSheetOpen(true)}>
            Filters
          </Button>
          {hasActiveFilters && (
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Active</span>
          )}
          <span className="text-xs text-gray-500">
            Sort: <span className="font-medium text-gray-700">{sortLabel}</span> ({orderLabel})
          </span>
        </div>
      )}

      {!isLg && (
        <Dialog open={sheetOpen} onOpenChange={setSheetOpen}>
          <DialogContent className="inset-x-2 bottom-2 top-[8dvh] max-w-2xl mx-auto overflow-y-auto rounded-xl border border-gray-200 p-4">
            <div className="sticky top-0 -mx-4 px-4 -mt-4 pt-4 pb-3 bg-white border-b border-gray-100 flex items-start gap-3 z-10">
              <div className="min-w-0 flex-1">
                <DialogTitle className="text-lg font-semibold text-gray-900 pr-8">Filters</DialogTitle>
                <DialogDescription className="sr-only">Change catalog filters and annotation-based options.</DialogDescription>
                <p className="text-xs text-gray-500 mt-0.5">Adjust filters and sort, then tap Done.</p>
              </div>
              <DialogClose asChild>
                <button
                  type="button"
                  className="shrink-0 rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tm-mist"
                  aria-label="Close filters"
                >
                  <X className="h-5 w-5" strokeWidth={2} aria-hidden />
                </button>
              </DialogClose>
            </div>

            <div className="pt-4">
              {renderFilterBody()}
            </div>

            <div className="mt-4 border-t border-gray-200 pt-3">
              <div className="flex flex-wrap gap-3 items-start">
                <div className="flex flex-col min-w-[10rem] flex-1">
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

                <div className="flex flex-col min-w-[10rem] flex-1">
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
              </div>

              <div className="mt-3 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={handleClearOrReset}
                  className="h-10 px-3 py-2 text-sm text-green-700 hover:text-green-900 hover:bg-green-50 rounded-lg transition-colors"
                >
                  Clear filters
                </button>
                <Button type="button" variant="ghost" size="md" onClick={() => setSheetOpen(false)}>
                  Done
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

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
                <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
              </button>
            </span>
          ))}
        </div>
      )}

      <div
        className={`hidden lg:block transition-all duration-200 ${
          expanded ? "max-h-[8000px] opacity-100 overflow-visible" : "max-h-0 opacity-0 overflow-hidden"
        }`}
      >
        {renderFilterBody()}
      </div>

      {isLg && (
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
          <span className="block text-xs mb-1 invisible select-none" aria-hidden="true">
            Sort
          </span>
          <button
            type="button"
            onClick={handleClearOrReset}
            className="h-10 px-3 py-2 text-sm text-green-600 hover:text-green-800 hover:bg-green-50 rounded-lg transition-colors flex items-center"
          >
            Clear filters
          </button>
        </div>
      </div>
      )}
    </div>
  );
}
