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
} from "./db";
import SearchBar from "./components/SearchBar";
import FilterPanel from "./components/FilterPanel";
import CardGrid from "./components/CardGrid";
import CardDetail from "./components/CardDetail";
import AttributeManager from "./components/AttributeManager";
import CustomCardForm from "./components/CustomCardForm";
import Pagination from "./components/Pagination";
import SqlConsole from "./components/SqlConsole";

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
    sort_by: "pokedex",
    sort_dir: "asc",
  });
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  // ── Filter dropdown options (fetched once on mount) ─────────────────
  const [filterOptions, setFilterOptions] = useState(null);

  // ── Attribute definitions (for the annotation editor) ───────────────
  const [attributes, setAttributes] = useState([]);

  // ── UI state ────────────────────────────────────────────────────────
  const [selectedCardId, setSelectedCardId] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showSqlConsole, setShowSqlConsole] = useState(false);
  const [showCustomCardForm, setShowCustomCardForm] = useState(false);

  // ── Fetch filter options and attribute definitions on mount ─────────
  useEffect(() => {
    fetchFilterOptions()
      .then(setFilterOptions)
      .catch((err) => console.error("Failed to load filter options:", err));

    fetchAttributes()
      .then(setAttributes)
      .catch((err) => console.error("Failed to load attributes:", err));
  }, []);

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
  const handleFilterChange = (newFilters) => {
    setFilters((prev) => ({ ...prev, ...newFilters }));
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

  // Refresh cards and filters after adding a custom card.
  const handleCustomCardAdded = () => {
    loadCards();
    fetchFilterOptions().then(setFilterOptions).catch(console.error);
  };

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      {/* Header */}
      <header className="bg-green-600 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">
            Tropius Maximus Pokemon Tracker
          </h1>
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
              {showSettings ? "Close Settings" : "Settings"}
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

            <AttributeManager
              attributes={attributes}
              onChanged={handleAttributesChanged}
            />
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
          return (
            <CardDetail
              cardId={selectedCardId}
              attributes={attributes}
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
