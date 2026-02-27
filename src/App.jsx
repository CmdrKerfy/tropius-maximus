/**
 * App.jsx — Top-level component that manages all application state.
 *
 * State lives here and is passed down to child components as props.
 * Data comes from DuckDB-WASM (db.js) instead of a backend API.
 */

import { useState, useEffect, useCallback } from "react";
import {
  fetchCards,
  fetchFilterOptions,
  fetchAttributes,
  getCustomSourceNames,
} from "./db";
import { getToken, setToken } from "./lib/github";
import SearchBar from "./components/SearchBar";
import FilterPanel from "./components/FilterPanel";
import CardGrid from "./components/CardGrid";
import CardDetail from "./components/CardDetail";
import AttributeManager from "./components/AttributeManager";
import CustomCardForm from "./components/CustomCardForm";
import Pagination from "./components/Pagination";
import SqlConsole from "./components/SqlConsole";

function sortCards(arr, sort_by, sort_dir) {
  const dir = sort_dir === "desc" ? -1 : 1;
  return [...arr].sort((a, b) => {
    let av, bv;
    if (sort_by === "pokedex") {
      av = a.pokedex_numbers?.[0] ?? Infinity;
      bv = b.pokedex_numbers?.[0] ?? Infinity;
    } else if (sort_by === "number") {
      av = parseFloat(a.number) || 0;
      bv = parseFloat(b.number) || 0;
    } else if (sort_by === "hp") {
      av = Number(a.hp) || 0;
      bv = Number(b.hp) || 0;
    } else {
      av = String(a[sort_by] || "").toLowerCase();
      bv = String(b[sort_by] || "").toLowerCase();
    }
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });
}

export default function App() {
  // ── Card list state ─────────────────────────────────────────────────
  const [cards, setCards] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(40);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // ── SQL grid overlay state ────────────────────────────────────────
  const [sqlCards, setSqlCards] = useState(null);

  // ── Multi-select state for bulk SQL operations ───────────────────
  const [selectedCardIds, setSelectedCardIds] = useState(new Set());

  // ── Search and filter state ─────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState({
    source: "TCG",
    supertype: "",
    rarity: "",
    set_id: "base1",
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
    sort_by: "pokedex",
    sort_dir: "asc",
  });
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  // ── Filter dropdown options (fetched once on mount) ─────────────────
  const [filterOptions, setFilterOptions] = useState(null);

  // ── Attribute definitions (for the annotation editor) ───────────────
  const [attributes, setAttributes] = useState([]);

  // ── Custom source names (from JSON) ────────────────────────────────
  const [customSources, setCustomSources] = useState([]);

  // ── UI state ────────────────────────────────────────────────────────
  const [selectedCardId, setSelectedCardId] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showSqlConsole, setShowSqlConsole] = useState(false);
  const [showCustomCardForm, setShowCustomCardForm] = useState(false);

  // ── GitHub PAT state ─────────────────────────────────────────────────
  const [ghToken, setGhToken] = useState(() => getToken());
  const [showTokenInput, setShowTokenInput] = useState(false);

  // ── Fetch filter options and attribute definitions on mount ─────────
  useEffect(() => {
    fetchFilterOptions(filters.source)
      .then(setFilterOptions)
      .catch((err) => console.error("Failed to load filter options:", err));

    fetchAttributes()
      .then(setAttributes)
      .catch((err) => console.error("Failed to load attributes:", err));

    setCustomSources(getCustomSourceNames());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch cards whenever search, filters, or page changes ──────────
  const loadCards = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCards({
        q: searchQuery,
        ...filters,
        page,
        page_size: pageSize,
      });
      setCards(data.cards);
      setTotal(data.total);
    } catch (err) {
      setError(err.message);
      setCards([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, filters, page, pageSize]);

  useEffect(() => {
    loadCards();
  }, [loadCards]);

  // ── Handlers ────────────────────────────────────────────────────────

  // When the search query changes, reset to page 1.
  const handleSearch = (query) => {
    setSearchQuery(query);
    setPage(1);
    setSqlCards(null);
  };

  // When any filter changes, reset to page 1.
  // When source changes, reset all filters and re-fetch filter options.
  // Exception: switching TO "All" preserves the current search and filters.
  const handleFilterChange = (newFilters) => {
    if ("source" in newFilters && newFilters.source !== filters.source) {
      const newSource = newFilters.source;
      if (newSource === "") {
        // "All" mode: keep existing search/filters, just switch source and
        // normalise sort to "name" (TCG-only sort options aren't available).
        setFilters((prev) => ({
          ...prev,
          source: "",
          sort_by: "name",
        }));
      } else {
        setFilters({
          source: newSource,
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
          sort_by: "name",
          sort_dir: "asc",
        });
        setSearchQuery("");
      }
      fetchFilterOptions(newSource)
        .then(setFilterOptions)
        .catch((err) => console.error("Failed to load filter options:", err));
    } else {
      setFilters((prev) => ({ ...prev, ...newFilters }));

      // If only sort_by/sort_dir changed and SQL results are displayed,
      // re-sort them client-side rather than clearing them.
      const isSortOnly = Object.keys(newFilters).every(
        (k) => k === "sort_by" || k === "sort_dir"
      );
      if (sqlCards && isSortOnly) {
        const merged = { ...filters, ...newFilters };
        setSqlCards(sortCards(sqlCards, merged.sort_by, merged.sort_dir));
        return;
      }
    }
    setPage(1);
    setSqlCards(null);
  };

  // Refresh attribute definitions after creating/deleting one.
  const handleAttributesChanged = () => {
    fetchAttributes().then(setAttributes).catch(console.error);
  };

  const handleShowInGrid = (cards) => setSqlCards(cards);

  // ── Card selection handlers ──────────────────────────────────────
  const handleToggleCardSelection = (cardId) => {
    setSelectedCardIds((prev) => {
      const next = new Set(prev);
      next.has(cardId) ? next.delete(cardId) : next.add(cardId);
      return next;
    });
  };

  const handleSelectAllVisible = () => {
    setSelectedCardIds(new Set((sqlCards || cards).map((c) => c.id)));
  };

  const handleClearSelection = () => setSelectedCardIds(new Set());

  const handleSqlDataChanged = (changed) => {
    if (changed.attributes)
      fetchAttributes().then(setAttributes).catch(console.error);
    if (changed.cards) {
      loadCards();
      fetchFilterOptions().then(setFilterOptions).catch(console.error);
    }
  };

  // Refresh cards, filters, and custom sources after adding a custom card.
  const handleCustomCardAdded = () => {
    loadCards();
    setCustomSources(getCustomSourceNames());
    fetchFilterOptions(filters.source).then(setFilterOptions).catch(console.error);
  };

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      {/* Header */}
      <header className="bg-green-600 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/favicon.png" alt="Tropius" className="h-16 w-16 rounded-full object-cover" />
            <h1 className="text-2xl font-bold tracking-tight">
              Tropius Maximus Pokemon Tracker
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setShowSqlConsole(!showSqlConsole);
                if (!showSqlConsole) setShowSettings(false);
              }}
              className="px-3 py-1.5 bg-green-700 hover:bg-green-800 rounded text-sm font-medium transition-colors"
            >
              {showSqlConsole ? "Close SQL" : "SQL Console"}
            </button>
            <button
              onClick={() => {
                setShowSettings(!showSettings);
                if (!showSettings) setShowSqlConsole(false);
              }}
              className="px-3 py-1.5 bg-green-700 hover:bg-green-800 rounded text-sm font-medium transition-colors"
            >
              {showSettings ? "Close" : "Custom Cards"}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* SQL Console panel */}
        {showSqlConsole && (
          <div className="mb-6">
            <SqlConsole
              onShowInGrid={handleShowInGrid}
              onDataChanged={handleSqlDataChanged}
              selectedCardIds={selectedCardIds}
            />
          </div>
        )}

        {/* Settings panel (attribute manager + data info) */}
        {showSettings && (
          <div className="mb-6 space-y-4">
            {/* Data info (replaces Update Cards) */}
            <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
              <h2 className="font-semibold text-gray-800 mb-3">
                Card Data
              </h2>
              <p className="text-sm text-gray-600">
                Card data is updated automatically via GitHub Actions.
              </p>
              <p className="text-xs text-gray-400 mt-1">
                Last build: {typeof __BUILD_DATE__ !== "undefined" ? new Date(__BUILD_DATE__).toLocaleDateString() : "unknown"}
              </p>

              {/* GitHub PAT */}
              <div className="mt-3 border-t border-gray-100 pt-3 space-y-1.5">
                {ghToken ? (
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-green-700">GitHub PAT configured</span>
                    <button
                      type="button"
                      onClick={() => setShowTokenInput(!showTokenInput)}
                      className="text-xs text-gray-500 hover:text-gray-700 underline"
                    >
                      {showTokenInput ? "Hide" : "Change"}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setToken(""); setGhToken(""); }}
                      className="text-xs text-red-500 hover:text-red-700 underline"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-gray-600">
                    No GitHub PAT —{" "}
                    <button
                      type="button"
                      onClick={() => setShowTokenInput(true)}
                      className="text-blue-600 hover:underline"
                    >
                      Add PAT
                    </button>{" "}
                    to sync annotations and cards across devices.
                  </p>
                )}
                {(!ghToken || showTokenInput) && (
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={ghToken}
                      onChange={(e) => setGhToken(e.target.value)}
                      placeholder="github_pat_..."
                      className="flex-1 px-2 py-1 border border-gray-300 rounded text-xs font-mono
                                 focus:outline-none focus:ring-1 focus:ring-green-500"
                    />
                    <button
                      type="button"
                      onClick={() => { setToken(ghToken); setShowTokenInput(false); }}
                      className="px-2 py-1 bg-gray-700 text-white rounded text-xs hover:bg-gray-800"
                    >
                      Save
                    </button>
                  </div>
                )}
              </div>

              <button
                onClick={() => setShowCustomCardForm(!showCustomCardForm)}
                className="mt-3 px-3 py-1.5 bg-green-600 text-white rounded text-sm font-medium
                           hover:bg-green-700 transition-colors"
              >
                {showCustomCardForm ? "Hide Form" : "+ Add Custom Card"}
              </button>
            </div>

            {/* Custom Card Form */}
            {showCustomCardForm && (
              <CustomCardForm
                onCardAdded={handleCustomCardAdded}
                onClose={() => setShowCustomCardForm(false)}
              />
            )}

            {/* AttributeManager hidden for now */}
          </div>
        )}

        {/* Search bar */}
        <SearchBar value={searchQuery} onChange={handleSearch} />

        {/* Filters */}
        {filterOptions && (
          <FilterPanel
            options={filterOptions}
            filters={filters}
            onChange={handleFilterChange}
            expanded={filtersExpanded}
            onToggleExpand={() => setFiltersExpanded((prev) => !prev)}
            customSources={customSources}
          />
        )}

        {/* Results count */}
        {!sqlCards && (
          <div className="mt-4 mb-2 text-sm text-gray-500">
            {loading
              ? "Loading..."
              : `${total.toLocaleString()} card${total !== 1 ? "s" : ""} found`}
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {/* SQL mode banner */}
        {sqlCards && (
          <div className="mt-4 mb-2 bg-amber-50 border border-amber-200 rounded px-4 py-2 flex items-center justify-between">
            <span className="text-sm text-amber-800">
              Showing {sqlCards.length} card{sqlCards.length !== 1 ? "s" : ""}{" "}
              from SQL query
            </span>
            <button
              onClick={() => {
                setSqlCards(null);
                setSelectedCardIds(new Set());
              }}
              className="text-sm text-amber-700 hover:text-amber-900 font-medium underline"
            >
              Back to Browse
            </button>
          </div>
        )}

        {/* Selection toolbar */}
        {(showSqlConsole || selectedCardIds.size > 0) && (
          <div className="mt-4 mb-2 bg-gray-100 border border-gray-200 rounded px-4 py-2 flex items-center gap-4">
            <span className="text-sm text-gray-700">
              <span className="font-medium">{selectedCardIds.size}</span> card
              {selectedCardIds.size !== 1 ? "s" : ""} selected
            </span>
            <button
              onClick={handleSelectAllVisible}
              className="text-sm text-green-600 hover:text-green-800 font-medium"
            >
              Select All Visible
            </button>
            <button
              onClick={handleClearSelection}
              disabled={selectedCardIds.size === 0}
              className="text-sm text-gray-600 hover:text-gray-800 font-medium disabled:text-gray-400"
            >
              Clear Selection
            </button>
          </div>
        )}

        {/* Card grid */}
        {(!error || sqlCards) && (
          <CardGrid
            cards={sqlCards || cards}
            loading={sqlCards ? false : loading}
            onCardClick={(id) => setSelectedCardId(id)}
            selectedCardIds={selectedCardIds}
            onToggleSelection={showSqlConsole ? handleToggleCardSelection : null}
          />
        )}

        {/* Pagination */}
        {!sqlCards && total > pageSize && (
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
          />
        )}

        {/* Card detail modal */}
        {selectedCardId && (() => {
          const displayedCards = sqlCards || cards;
          const cardIds = displayedCards.map(c => c.id);
          const currentIndex = cardIds.indexOf(selectedCardId);
          const cardSource = filters.source || displayedCards[currentIndex]?._source || "TCG";
          return (
            <CardDetail
              cardId={selectedCardId}
              attributes={attributes}
              source={cardSource}
              onClose={() => setSelectedCardId(null)}
              hasPrev={currentIndex > 0}
              hasNext={currentIndex < cardIds.length - 1}
              onPrev={() => setSelectedCardId(cardIds[currentIndex - 1])}
              onNext={() => setSelectedCardId(cardIds[currentIndex + 1])}
            />
          );
        })()}
      </main>
    </div>
  );
}
