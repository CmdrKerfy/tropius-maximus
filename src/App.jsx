/**
 * App.jsx — Top-level component that manages all application state.
 *
 * State lives here and is passed down to child components as props.
 * Data comes from DuckDB-WASM (db.js) instead of a backend API.
 */

import { useState, useEffect, useCallback, useMemo, useRef, Component } from "react";
import {
  fetchCards,
  fetchFilterOptions,
  fetchAttributes,
  deleteCardsById,
  syncMutableTablesToIndexedDB,
} from "./db";
import { getToken, setToken, deleteCardsFromGitHub, getFileContents, updateFileContents, pollWorkflowRun } from "./lib/github";
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

const FILTER_STORAGE_KEY = "tm_filters";
const SEARCH_STORAGE_KEY = "tm_search";

/** Catches render errors in card detail modal so the app doesn't go blank. */
class CardDetailErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("CardDetail error:", error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-2">Something went wrong</h2>
            <p className="text-sm text-gray-600 mb-4 font-mono break-all">
              {this.state.error?.message ?? String(this.state.error)}
            </p>
            <button
              type="button"
              onClick={() => {
                this.setState({ error: null });
                this.props.onClose?.();
              }}
              className="w-full px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700"
            >
              Close
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const DEFAULT_FILTERS = {
  source: "", supertype: "", rarity: [], set_id: [], region: [],
  generation: "", color: "", artist: [], evolution_line: [],
  trainer_type: "", specialty: [], background_pokemon: [], element: [], card_type: [],
  stage: [], weather: [], environment: [], actions: [], pose: [],
  sort_by: "pokedex", sort_dir: "asc",
};

const ARRAY_FILTER_KEYS = new Set([
  "rarity", "set_id", "region", "artist", "evolution_line",
  "specialty", "background_pokemon", "element", "card_type", "stage", "weather", "environment", "actions", "pose",
]);

// Values to omit from URL (defaults → clean URL)
const URL_FILTER_DEFAULTS = { sort_by: "pokedex", sort_dir: "asc" };

function readUrlState() {
  const params = new URLSearchParams(window.location.search);
  const urlFilters = {};
  for (const key of Object.keys(DEFAULT_FILTERS)) {
    if (ARRAY_FILTER_KEYS.has(key)) {
      const vals = params.getAll(key);
      if (vals.length) urlFilters[key] = vals;
    } else {
      const val = params.get(key);
      if (val !== null) urlFilters[key] = val;
    }
  }
  return {
    urlFilters,
    searchQuery: params.has("q") ? params.get("q") : null, // null = not in URL
    page: Math.max(1, parseInt(params.get("page") || "1", 10)),
    selectedCardId: params.get("card") || null,
  };
}

function buildUrlParams(filters, searchQuery, page, selectedCardId) {
  const p = new URLSearchParams();
  if (selectedCardId) p.set("card", selectedCardId);
  if (searchQuery) p.set("q", searchQuery);
  if (page > 1) p.set("page", String(page));
  for (const [key, value] of Object.entries(filters)) {
    if (ARRAY_FILTER_KEYS.has(key)) {
      for (const v of value) p.append(key, v);
    } else {
      if (!value || value === URL_FILTER_DEFAULTS[key]) continue;
      p.set(key, value);
    }
  }
  return p;
}

export default function App() {
  // ── Card list state ─────────────────────────────────────────────────
  const [cards, setCards] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(() => readUrlState().page);
  const [pageSize] = useState(60);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // ── SQL grid overlay state ────────────────────────────────────────
  const [sqlCards, setSqlCards] = useState(null);

  // ── Multi-select state for bulk SQL operations ───────────────────
  const [selectedCardIds, setSelectedCardIds] = useState(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteInProgress, setDeleteInProgress] = useState(false);

  // ── Search and filter state ─────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState(() => {
    const { searchQuery: urlQ } = readUrlState();
    if (urlQ !== null) return urlQ;
    return localStorage.getItem(SEARCH_STORAGE_KEY) || "";
  });
  const [filters, setFilters] = useState(() => {
    const { urlFilters } = readUrlState();
    if (Object.keys(urlFilters).length > 0) return { ...DEFAULT_FILTERS, ...urlFilters };
    try {
      const saved = localStorage.getItem(FILTER_STORAGE_KEY);
      return saved ? { ...DEFAULT_FILTERS, ...JSON.parse(saved) } : DEFAULT_FILTERS;
    } catch {
      return DEFAULT_FILTERS;
    }
  });
  const [filtersExpanded, setFiltersExpanded] = useState(true);

  // ── Filter dropdown options (fetched once on mount) ─────────────────
  const [filterOptions, setFilterOptions] = useState(null);

  // ── Attribute definitions (for the annotation editor) ───────────────
  const [attributes, setAttributes] = useState([]);

  // ── UI state ────────────────────────────────────────────────────────
  const [selectedCardId, setSelectedCardId] = useState(() => readUrlState().selectedCardId);
  const prevSelectedCardIdRef = useRef(selectedCardId);
  const [showSettings, setShowSettings] = useState(false);
  const [showSqlConsole, setShowSqlConsole] = useState(false);
  const [showCustomCardForm, setShowCustomCardForm] = useState(false);

  // ── GitHub PAT state ─────────────────────────────────────────────────
  const patSectionRef = useRef(null);
  const [ghToken, setGhToken] = useState(() => getToken());
  const [patSaved, setPatSaved] = useState(() => !!getToken());
  const [showTokenInput, setShowTokenInput] = useState(false);
  const [pushStatus, setPushStatus] = useState(null); // null | "pushing" | "success" | "error"
  const [pushMessage, setPushMessage] = useState("");

  // ── Annotation sync queue (CardDetail → GitHub) ───────────────────────
  const [pendingSyncCardIds, setPendingSyncCardIds] = useState([]);
  const [syncStatus, setSyncStatus] = useState("idle"); // "idle" | "syncing" | "done" | "error"
  const [lastSyncedCardIds, setLastSyncedCardIds] = useState([]);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [syncError403, setSyncError403] = useState(false); // true when last sync failed with 403 (token)
  const syncDoneTimeoutRef = useRef(null);
  const syncRunnerRef = useRef(null); // CardDetail sets this so banner Retry can trigger sync
  const workflowPollTimeoutRef = useRef(null);
  const workflowBuildingRef = useRef(false); // true while build is in progress; CardDetail reads this to hold pushes
  const pendingSyncCardIdsRef = useRef([]); // mirror of pendingSyncCardIds for use inside callbacks
  const [workflowHtmlUrl, setWorkflowHtmlUrl] = useState(null);

  // ── Fetch filter options and attribute definitions on mount ─────────
  useEffect(() => {
    fetchFilterOptions(filters.source)
      .then(setFilterOptions)
      .catch((err) => console.error("Failed to load filter options:", err));

    fetchAttributes()
      .then(setAttributes)
      .catch((err) => console.error("Failed to load attributes:", err));
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

  useEffect(() => {
    localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filters));
  }, [filters]);

  useEffect(() => {
    localStorage.setItem(SEARCH_STORAGE_KEY, searchQuery);
  }, [searchQuery]);

  // ── URL sync ─────────────────────────────────────────────────────────
  useEffect(() => {
    const prev = prevSelectedCardIdRef.current;
    prevSelectedCardIdRef.current = selectedCardId;

    const params = buildUrlParams(filters, searchQuery, page, selectedCardId);
    const newSearch = params.toString() ? `?${params}` : "";
    const newUrl = window.location.pathname + newSearch;

    if (prev === null && selectedCardId !== null) {
      // Opening a card from the grid → push so Back button closes it
      history.pushState({ selectedCardId }, "", newUrl);
    } else {
      // Card-to-card, closing, or filter/search/page change → replace
      history.replaceState({ selectedCardId }, "", newUrl);
    }
  }, [filters, searchQuery, page, selectedCardId]);

  useEffect(() => {
    const handlePopState = () => {
      const { urlFilters, searchQuery: urlQ, page: urlPage, selectedCardId: urlCard } = readUrlState();
      prevSelectedCardIdRef.current = selectedCardId; // sync ref before state update
      setFilters({ ...DEFAULT_FILTERS, ...urlFilters });
      setSearchQuery(urlQ !== null ? urlQ : "");
      setPage(urlPage);
      setSelectedCardId(urlCard);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [selectedCardId]);

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
          sort_by: "name",
          sort_dir: "asc",
        });
        setSearchQuery("");
      }
      fetchFilterOptions(newSource)
        .then(setFilterOptions)
        .catch((err) => console.error("Failed to load filter options:", err));
    } else {
      const normalized = { ...newFilters };
      for (const key of ARRAY_FILTER_KEYS) {
        if (key in normalized && Array.isArray(normalized[key])) {
          normalized[key] = [...new Set(normalized[key])];
        }
      }
      setFilters((prev) => ({ ...prev, ...normalized }));

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

  // Dedupe by id so each card appears once (fixes duplicate keys / stuck layout).
  // When the same id appears twice (e.g. API + custom Pikachu), prefer the custom card so it shows in the grid.
  const displayedCards = useMemo(() => {
    const raw = sqlCards || cards;
    const byId = new Map();
    const order = [];
    for (const c of raw) {
      const existing = byId.get(c.id);
      if (!existing) {
        byId.set(c.id, c);
        order.push(c.id);
      } else if (c.is_custom && !existing.is_custom) {
        byId.set(c.id, c);
      }
    }
    return order.map((id) => byId.get(id));
  }, [sqlCards, cards]);

  // ── Card selection handlers ──────────────────────────────────────
  const handleToggleCardSelection = (cardId) => {
    setSelectedCardIds((prev) => {
      const next = new Set(prev);
      next.has(cardId) ? next.delete(cardId) : next.add(cardId);
      return next;
    });
  };

  const handleSelectAllVisible = useCallback(() => {
    setSelectedCardIds(new Set(displayedCards.map((c) => c.id)));
  }, [displayedCards]);

  const handleClearSelection = () => setSelectedCardIds(new Set());

  const handleDeleteSelected = async () => {
    setDeleteInProgress(true);
    try {
      const deleted = await deleteCardsById(selectedCardIds);
      if (deleted.length > 0) {
        const token = getToken();
        if (token) {
          try {
            await deleteCardsFromGitHub(token, deleted);
          } catch (e) {
            console.warn("GitHub delete failed:", e.message);
          }
        }
      }
      setSelectedCardIds(new Set());
      setShowDeleteConfirm(false);
      setSqlCards(null);
      setPage(1);
      loadCards();
    } finally {
      setDeleteInProgress(false);
    }
  };

  const handlePushToGitHub = async () => {
    setPushStatus("pushing");
    setPushMessage("");
    try {
      const { customCardsData } = await syncMutableTablesToIndexedDB();
      const token = getToken();
      const { sha } = await getFileContents(token);
      await updateFileContents(token, customCardsData, sha, "Manual sync: push local custom cards to GitHub");
      setPushStatus("success");
      setPushMessage(`${customCardsData.cards.length} card(s) pushed to GitHub.`);
    } catch (e) {
      setPushStatus("error");
      const msg = e.message || "";
      if (msg.includes("403")) {
        setPushMessage(
          "Permission denied (403). Your token needs Contents: Read and write access for this repo. " +
          "Regenerate it at GitHub → Settings → Developer settings → Personal access tokens."
        );
      } else {
        setPushMessage(msg);
      }
    }
  };

  // Annotation sync queue callbacks (used by CardDetail)
  const handleSyncQueued = useCallback((cardId) => {
    if (!cardId) return;
    setPendingSyncCardIds((prev) => (prev.includes(cardId) ? prev : [...prev, cardId]));
  }, []);
  const handleSyncStarted = useCallback(() => {
    setSyncStatus("syncing");
    setSyncError403(false);
  }, []);
  const startWorkflowPolling = useCallback(async (commitSha, attemptCount = 0) => {
    const MAX_ATTEMPTS = 20; // 5s initial delay + up to 20 × 15s ≈ 5 min
    const token = getToken();
    if (!token || attemptCount >= MAX_ATTEMPTS) {
      setSyncStatus("idle");
      setWorkflowHtmlUrl(null);
      return;
    }
    const run = await pollWorkflowRun(token, commitSha);
    if (!run) {
      // Workflow not registered yet — retry
      workflowPollTimeoutRef.current = setTimeout(() => startWorkflowPolling(commitSha, attemptCount + 1), 10000);
      return;
    }
    setWorkflowHtmlUrl(run.htmlUrl);
    if (run.status === "completed") {
      workflowBuildingRef.current = false; // unblock any held push immediately
      if (run.conclusion === "success") {
        setSyncStatus("deployed");
        syncDoneTimeoutRef.current = setTimeout(() => {
          setSyncStatus("idle");
          setWorkflowHtmlUrl(null);
          syncDoneTimeoutRef.current = null;
        }, 6000);
      } else {
        setSyncStatus("deploy_failed");
      }
      // Flush any edits that were queued while the build was running.
      if (pendingSyncCardIdsRef.current.length > 0) syncRunnerRef.current?.();
    } else {
      workflowPollTimeoutRef.current = setTimeout(() => startWorkflowPolling(commitSha, attemptCount + 1), 15000);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSyncCompleted = useCallback((cardIds = [], commitSha = null) => {
    setLastSyncedCardIds(Array.isArray(cardIds) ? cardIds : []);
    setPendingSyncCardIds([]);
    setLastSyncedAt(Date.now());
    if (workflowPollTimeoutRef.current) clearTimeout(workflowPollTimeoutRef.current);
    if (commitSha && getToken()) {
      setSyncStatus("building");
      // Give GitHub 5s to register the workflow run before first poll
      workflowPollTimeoutRef.current = setTimeout(() => startWorkflowPolling(commitSha), 5000);
    } else {
      setSyncStatus("done");
      if (syncDoneTimeoutRef.current) clearTimeout(syncDoneTimeoutRef.current);
      syncDoneTimeoutRef.current = setTimeout(() => {
        setSyncStatus("idle");
        setLastSyncedCardIds([]);
        syncDoneTimeoutRef.current = null;
      }, 5000);
    }
  }, [startWorkflowPolling]);
  const handleSyncFailed = useCallback((is403 = false) => {
    setSyncStatus("error");
    setSyncError403(!!is403);
  }, []);

  useEffect(() => () => {
    if (syncDoneTimeoutRef.current) clearTimeout(syncDoneTimeoutRef.current);
    if (workflowPollTimeoutRef.current) clearTimeout(workflowPollTimeoutRef.current);
  }, []);

  // Keep refs in sync so stable callbacks (startWorkflowPolling) can read current values.
  useEffect(() => { workflowBuildingRef.current = syncStatus === "building"; }, [syncStatus]);
  useEffect(() => { pendingSyncCardIdsRef.current = pendingSyncCardIds; }, [pendingSyncCardIds]);

  const handleSqlDataChanged = (changed) => {
    if (changed.attributes)
      fetchAttributes().then(setAttributes).catch(console.error);
    if (changed.cards) {
      loadCards();
      fetchFilterOptions().then(setFilterOptions).catch(console.error);
    }
  };

  // Refresh cards and filter options after adding a custom card.
  const handleCustomCardAdded = () => {
    loadCards();
    fetchFilterOptions(filters.source).then(setFilterOptions).catch(console.error);
  };

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      {/* Header */}
      <header className="bg-green-600 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={`${import.meta.env.BASE_URL}favicon.png`} alt="Tropius" className="h-16 w-16 rounded-full object-cover" />
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
              <div ref={patSectionRef} className="mt-3 border-t border-gray-100 pt-3 space-y-1.5">
                {patSaved ? (
                  <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2 flex items-center justify-between">
                    <span>GitHub PAT configured</span>
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => setShowTokenInput(!showTokenInput)}
                        className="text-green-800 font-medium hover:underline"
                      >
                        {showTokenInput ? "Hide" : "Change"}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setToken(""); setGhToken(""); setPatSaved(false); }}
                        className="text-red-500 hover:text-red-700 font-medium hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                    No GitHub PAT —{" "}
                    <button
                      type="button"
                      onClick={() => setShowTokenInput(true)}
                      className="text-amber-800 font-medium hover:underline"
                    >
                      Add PAT
                    </button>{" "}
                    to sync annotations and cards across devices.
                  </div>
                )}
                {(!patSaved || showTokenInput) && (
                  <p className="text-xs text-gray-500 font-medium">Paste Token Here:</p>
                )}
                {(!patSaved || showTokenInput) && (
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
                      onClick={() => { setToken(ghToken); setShowTokenInput(false); setPatSaved(!!ghToken.trim()); }}
                      className="px-2 py-1 bg-gray-700 text-white rounded text-xs hover:bg-gray-800"
                    >
                      Save
                    </button>
                  </div>
                )}
              </div>

              <div className="mt-3 flex flex-wrap gap-2 items-center">
                <button
                  onClick={() => setShowCustomCardForm(!showCustomCardForm)}
                  className="px-3 py-1.5 bg-green-600 text-white rounded text-sm font-medium
                             hover:bg-green-700 transition-colors"
                >
                  {showCustomCardForm ? "Hide Form" : "+ Add Custom Card"}
                </button>
                <button
                  onClick={handlePushToGitHub}
                  disabled={!ghToken || pushStatus === "pushing"}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm font-medium
                             hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {pushStatus === "pushing" ? "Pushing…" : "Push Local Cards to GitHub"}
                </button>
              </div>
              {pushStatus === "success" && (
                <p className="mt-2 text-xs text-green-700">{pushMessage}</p>
              )}
              {pushStatus === "error" && (
                <p className="mt-2 text-xs text-red-600">{pushMessage}</p>
              )}
            </div>

            {/* Custom Card Form */}
            {showCustomCardForm && (
              <CustomCardForm
                onCardAdded={handleCustomCardAdded}
                onClose={() => setShowCustomCardForm(false)}
                onOpenPAT={() => {
                  setShowTokenInput(true);
                  setTimeout(() => patSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
                }}
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
          <div className="mt-4 mb-2 bg-gray-100 border border-gray-200 rounded px-4 py-2 flex items-center gap-4 flex-wrap">
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
            <button
              onClick={() => setShowDeleteConfirm(true)}
              disabled={selectedCardIds.size === 0}
              className="ml-auto text-sm font-medium px-3 py-1 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Delete Selected Card{selectedCardIds.size !== 1 ? "s" : ""}
            </button>
          </div>
        )}

        {/* Annotation sync banner */}
        {(syncStatus === "syncing" || syncStatus === "done" || syncStatus === "building" || syncStatus === "deployed" || syncStatus === "deploy_failed" || syncStatus === "error" || (syncStatus === "idle" && pendingSyncCardIds.length > 0)) && (
          <div
            className={`mt-4 mb-2 rounded-lg px-4 py-2.5 flex items-center justify-between flex-wrap gap-2 ${
              syncStatus === "error" || syncStatus === "deploy_failed"
                ? "bg-red-50 border border-red-200 text-red-800"
                : syncStatus === "deployed"
                ? "bg-green-50 border border-green-200 text-green-800"
                : syncStatus === "syncing" || syncStatus === "building"
                ? "bg-blue-50 border border-blue-200 text-blue-800"
                : "bg-gray-50 border border-gray-200 text-gray-700"
            }`}
          >
            <span className="text-sm">
              {(syncStatus === "idle" && pendingSyncCardIds.length > 0) && (
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 rounded-full border-2 border-gray-400 border-t-transparent animate-spin" />
                  Edits saved to this device. Submitting to GitHub…
                </span>
              )}
              {syncStatus === "syncing" && (
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
                  Submitting to GitHub…
                </span>
              )}
              {syncStatus === "done" && "Edits saved to this device. Submitted to GitHub for permanent saving."}
              {syncStatus === "building" && (
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-3 h-3 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
                  Submitted to GitHub. Building site…{pendingSyncCardIds.length > 0 && " (new edits queued)"}
                </span>
              )}
              {syncStatus === "deployed" && "Site rebuilt. Changes are live."}
              {syncStatus === "deploy_failed" && (
                <span>
                  GitHub build failed.{" "}
                  {workflowHtmlUrl && (
                    <a href={workflowHtmlUrl} target="_blank" rel="noopener noreferrer" className="underline font-medium">
                      View on GitHub
                    </a>
                  )}
                </span>
              )}
              {syncStatus === "error" && (syncError403 ? "Edits saved to this device — couldn't submit (check your token in Settings)." : "Edits saved to this device — couldn't submit to GitHub.")}
            </span>
            <div className="flex items-center gap-2">
              {syncStatus === "error" && (
                <>
                  <button
                    type="button"
                    onClick={() => syncRunnerRef.current?.()}
                    className="text-sm font-medium px-3 py-1 rounded bg-red-600 text-white hover:bg-red-700"
                  >
                    Retry
                  </button>
                  {syncError403 && (
                    <button
                      type="button"
                      onClick={() => { setShowSettings(true); setSyncStatus("idle"); patSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }}
                      className="text-sm font-medium px-3 py-1 rounded bg-gray-600 text-white hover:bg-gray-700"
                    >
                      Settings
                    </button>
                  )}
                </>
              )}
              {(syncStatus === "done" || syncStatus === "deployed" || syncStatus === "deploy_failed" || (syncStatus === "error" && !syncError403)) && (
                <button
                  type="button"
                  onClick={() => { setSyncStatus("idle"); setLastSyncedCardIds([]); setSyncError403(false); setWorkflowHtmlUrl(null); }}
                  className="text-sm font-medium underline hover:no-underline"
                >
                  Dismiss
                </button>
              )}
            </div>
          </div>
        )}

        {/* Delete confirmation dialog */}
        {showDeleteConfirm && (() => {
          const nonCustomCount = displayedCards.filter(
            (c) => selectedCardIds.has(c.id) && (c._source === "TCG" || c._source === "Pocket")
          ).length;
          const customCount = selectedCardIds.size - nonCustomCount;
          const hasToken = !!getToken();
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
              <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4">
                <h2 className="text-lg font-semibold text-gray-900 mb-3">Delete Cards?</h2>

                {customCount > 0 && (
                  <p className="text-sm text-gray-700 mb-2">
                    <span className="font-semibold text-red-600">{customCount}</span> custom card
                    {customCount !== 1 ? "s" : ""} will be permanently deleted
                    {hasToken ? " from this browser and from GitHub." : " from this browser only. Add a GitHub PAT in Settings to also remove from GitHub."}
                  </p>
                )}

                {nonCustomCount > 0 && (
                  <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-2">
                    {nonCustomCount} TCG/Pocket card{nonCustomCount !== 1 ? "s" : ""} cannot be deleted and will be skipped.
                  </p>
                )}

                {customCount === 0 && (
                  <p className="text-sm text-gray-500 mb-2">
                    None of the selected cards are custom cards. Only custom cards can be deleted.
                  </p>
                )}

                <p className="text-xs text-gray-400 mt-3 mb-5">This cannot be undone.</p>

                <div className="flex gap-3 justify-end">
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    disabled={deleteInProgress}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteSelected}
                    disabled={deleteInProgress || customCount === 0}
                    className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {deleteInProgress ? "Deleting…" : "Yes, Delete"}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Card grid */}
        {(!error || sqlCards) && (
          <CardGrid
            cards={displayedCards}
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
          const cardIds = displayedCards.map(c => c.id);
          const currentIndex = cardIds.indexOf(selectedCardId);
          const cardSource = filters.source || displayedCards[currentIndex]?._source || "TCG";
          return (
            <CardDetailErrorBoundary onClose={() => setSelectedCardId(null)}>
            <CardDetail
              cardId={selectedCardId}
              attributes={attributes}
              source={cardSource}
              onClose={() => setSelectedCardId(null)}
              onCardDeleted={() => {
                setSelectedCardId(null);
                setSqlCards(null);
                setPage(1);
                loadCards();
              }}
              hasPrev={currentIndex > 0}
              hasNext={currentIndex < cardIds.length - 1}
              onPrev={() => setSelectedCardId(cardIds[currentIndex - 1])}
              onNext={() => setSelectedCardId(cardIds[currentIndex + 1])}
              onFilterClick={(filterKey, filterValue) => {
                setSelectedCardId(null);
                setSearchQuery("");
                setPage(1);
                setFilters({
                  ...DEFAULT_FILTERS,
                  [filterKey]: ARRAY_FILTER_KEYS.has(filterKey) ? [filterValue] : filterValue,
                });
              }}
              onSyncQueued={handleSyncQueued}
              onSyncStarted={handleSyncStarted}
              onSyncCompleted={handleSyncCompleted}
              onSyncFailed={handleSyncFailed}
              workflowBuildingRef={workflowBuildingRef}
              onRegisterSyncRunner={(fn) => { syncRunnerRef.current = fn; }}
            />
            </CardDetailErrorBoundary>
          );
        })()}
      </main>
    </div>
  );
}
