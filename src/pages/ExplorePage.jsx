/**
 * ExplorePage — Phase 4: primary Explore route (grid, filters, search, card detail).
 * Data via db.js router (DuckDB or Supabase).
 */

import { useState, useEffect, useCallback, useMemo, useRef, Component } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import {
  fetchCards,
  fetchExploreFilterOptions,
  fetchAttributes,
  deleteCardsById,
  syncMutableTablesToIndexedDB,
  appendCardToDefaultQueue,
  appendCardsToDefaultQueue,
  appendCardToWorkbenchQueue,
  appendCardsToWorkbenchQueue,
  fetchFirstNMatchingCardIds,
  fetchWorkbenchQueues,
  useSupabaseBackend,
} from "../db";
import { getToken, setToken, deleteCardsFromGitHub, getFileContents, updateFileContents, pollWorkflowRun } from "../lib/github";
import SearchBar from "../components/SearchBar";
import FilterPanel from "../components/FilterPanel";
import CardGrid from "../components/CardGrid";
import CardDetail from "../components/CardDetail";
import AttributeManager from "../components/AttributeManager";
import CustomCardForm from "../components/CustomCardForm";
import Pagination from "../components/Pagination";
import SqlConsole from "../components/SqlConsole";
import AuthUserMenu from "../components/AuthUserMenu.jsx";
import Button from "../components/ui/Button.jsx";
import Card from "../components/ui/Card.jsx";
import {
  getExploreFilterAvailability,
  exploreFilterDisabledTitle,
} from "../lib/exploreFilterAvailability";
import {
  DEFAULT_FILTERS,
  ARRAY_FILTER_KEYS,
  URL_FILTER_DEFAULTS,
  readUrlState,
  buildUrlParams,
} from "../lib/exploreUrlState.js";
import { toastSuccess, toastError, toastWarning } from "../lib/toast.js";
import { BATCH_EDIT_MAX_CARDS } from "../lib/batchLimits.js";
import { useBatchSelection } from "../hooks/useBatchSelection.js";
import { useExperimentalAppNav } from "../lib/navEnv.js";
import { shellPrimaryNavLinkClass as exploreNavLinkClass } from "../lib/appShellNavStyles.js";
import { exploreHasActiveConstraints } from "../lib/exploreFilterSummary.js";
import { exploreGridRowDedupeKey, pickExploreGridDuplicateWinner } from "../lib/exploreGridDedupe.js";
import Skeleton from "../components/ui/Skeleton.jsx";
import { getSupabase } from "../lib/supabaseClient.js";

const USE_SUPABASE_APP =
  import.meta.env.VITE_USE_SUPABASE === "true" &&
  Boolean(import.meta.env.VITE_SUPABASE_URL) &&
  Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY);
const WORKBENCH_QUEUE_STORAGE_KEY = "tm_workbench_queue_id";
const SET_TO_WORKBENCH_CONFIRM_THRESHOLD = 100;

function sortCards(arr, sort_by, sort_dir) {
  const dir = sort_dir === "desc" ? -1 : 1;
  const parseSortTime = (row) => {
    const candidates = [row?.created_at, row?.updated_at, row?.annotation_updated_at];
    for (const raw of candidates) {
      const ts = new Date(raw || 0).getTime();
      if (Number.isFinite(ts) && ts > 0) return ts;
    }
    return 0;
  };
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
    } else if (sort_by === "recent") {
      av = parseSortTime(a);
      bv = parseSortTime(b);
    } else {
      av = String(a[sort_by] || "").toLowerCase();
      bv = String(b[sort_by] || "").toLowerCase();
    }
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    const aId = String(a?.id || "");
    const bId = String(b?.id || "");
    if (aId < bId) return -1 * dir;
    if (aId > bId) return 1 * dir;
    return 0;
  });
}

const FILTER_STORAGE_KEY = "tm_filters";
const SEARCH_STORAGE_KEY = "tm_search";

/** Stable empty set for CardGrid when batch/SQL selection is off. */
const EMPTY_SELECTED_CARD_IDS = new Set();

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
            <Button
              type="button"
              variant="primary"
              size="lg"
              className="w-full"
              onClick={() => {
                this.setState({ error: null });
                this.props.onClose?.();
              }}
            >
              Close
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Shape matches fetchExploreFilterOptions; used so the filter bar renders before options load. */
const EMPTY_FILTER_OPTIONS = {
  supertypes: [],
  rarities: [],
  sets: [],
  regions: [],
  generations: [],
  colors: [],
  artists: [],
  evolution_lines: [],
  trainer_types: [],
  specialties: [],
  background_pokemon: [],
  card_types: [],
  elements: [],
  stages: [],
  weathers: [],
  environments: [],
  actions: [],
  poses: [],
};

/** Filter metadata changes rarely; long stale time avoids refetch on every visit. */
const FILTER_OPTIONS_STALE_MS = 30 * 60 * 1000;

export default function ExplorePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const experimentalNav = useExperimentalAppNav();
  const batchSelection = useBatchSelection(USE_SUPABASE_APP);
  /** Collapse batch chrome when the list is empty — saves space; opens automatically when count > 0. */
  const [batchExploreExpanded, setBatchExploreExpanded] = useState(false);

  useEffect(() => {
    if (batchSelection.count > 0) setBatchExploreExpanded(true);
  }, [batchSelection.count]);

  // ── Card list state ─────────────────────────────────────────────────
  const [page, setPage] = useState(() => readUrlState().page);
  const [pageSize] = useState(60);

  // ── SQL grid overlay state ────────────────────────────────────────
  const [sqlCards, setSqlCards] = useState(null);

  // ── Multi-select state for bulk SQL operations ───────────────────
  const [selectedCardIds, setSelectedCardIds] = useState(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteInProgress, setDeleteInProgress] = useState(false);
  const [workbenchListAppendBusy, setWorkbenchListAppendBusy] = useState(false);
  const [showBatchWorkbenchTargetPicker, setShowBatchWorkbenchTargetPicker] = useState(false);
  const [workbenchMatchingAppendBusy, setWorkbenchMatchingAppendBusy] = useState(false);
  const [showMatchingWorkbenchTargetPicker, setShowMatchingWorkbenchTargetPicker] = useState(false);
  const [workbenchSelectedAppendBusy, setWorkbenchSelectedAppendBusy] = useState(false);
  const [showSelectedWorkbenchTargetPicker, setShowSelectedWorkbenchTargetPicker] = useState(false);
  const [workbenchQueueId, setWorkbenchQueueId] = useState(() => {
    try {
      return typeof localStorage !== "undefined"
        ? localStorage.getItem(WORKBENCH_QUEUE_STORAGE_KEY) || ""
        : "";
    } catch {
      return "";
    }
  });

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

  // ── UI state ────────────────────────────────────────────────────────
  const [selectedCardId, setSelectedCardId] = useState(() => readUrlState().selectedCardId);
  const prevSelectedCardIdRef = useRef(selectedCardId);
  const setToWorkbenchInFlightRef = useRef(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showSqlConsole, setShowSqlConsole] = useState(false);
  const [showCustomCardForm, setShowCustomCardForm] = useState(false);
  /** Anonymous JWT: RLS 019 allows zero rows with no PostgREST error — explain in CardGrid. */
  const [supabaseSessionIsAnonymous, setSupabaseSessionIsAnonymous] = useState(false);

  /** Grid batch checkboxes only when tools are expanded or the list is non-empty (SQL mode keeps its own selection). */
  const batchModeActive = useMemo(
    () =>
      USE_SUPABASE_APP &&
      !sqlCards &&
      !showSqlConsole &&
      (batchExploreExpanded || batchSelection.count > 0),
    [sqlCards, showSqlConsole, batchExploreExpanded, batchSelection.count]
  );

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

  const { data: filterOptions } = useQuery({
    queryKey: ["filterOptions", "explore"],
    queryFn: fetchExploreFilterOptions,
    staleTime: FILTER_OPTIONS_STALE_MS,
    placeholderData: keepPreviousData,
  });
  const { data: workbenchQueues = [] } = useQuery({
    queryKey: ["workbenchQueues"],
    queryFn: fetchWorkbenchQueues,
    enabled: USE_SUPABASE_APP,
    staleTime: 15_000,
  });
  const selectedWorkbenchQueue = useMemo(() => {
    if (!workbenchQueues.length) return null;
    const found = workbenchQueueId
      ? workbenchQueues.find((q) => String(q.id) === String(workbenchQueueId))
      : null;
    return found || workbenchQueues[0];
  }, [workbenchQueues, workbenchQueueId]);

  const exploreDataBackend = USE_SUPABASE_APP ? "supabase" : "duckdb";
  const exploreFilterAvail = useMemo(
    () => getExploreFilterAvailability(filters.source, exploreDataBackend),
    [filters.source, exploreDataBackend]
  );
  const exploreFilterUnavailableTitle = useMemo(
    () => exploreFilterDisabledTitle(exploreDataBackend, filters.source),
    [exploreDataBackend, filters.source]
  );

  const { data: attributes = [] } = useQuery({
    queryKey: ["attributes"],
    queryFn: fetchAttributes,
  });

  const {
    data: cardsResult,
    isPending: cardsPending,
    isError: cardsQueryFailed,
    error: cardsQueryError,
  } = useQuery({
    queryKey: ["cards", searchQuery, filters, page, pageSize],
    queryFn: () =>
      fetchCards({
        q: searchQuery,
        ...filters,
        page,
        page_size: pageSize,
        // Exact total matches the filtered set (planned can disagree badly with filters/embeds).
        ...(USE_SUPABASE_APP ? { exact_count: true } : {}),
      }),
    placeholderData: keepPreviousData,
  });

  const cards = cardsResult?.cards ?? [];
  const total = cardsResult?.total ?? 0;

  useEffect(() => {
    if (!selectedWorkbenchQueue?.id) return;
    setWorkbenchQueueId(String(selectedWorkbenchQueue.id));
  }, [selectedWorkbenchQueue?.id]);
  useEffect(() => {
    if (workbenchQueues.length <= 1) {
      setShowBatchWorkbenchTargetPicker(false);
      setShowMatchingWorkbenchTargetPicker(false);
      setShowSelectedWorkbenchTargetPicker(false);
    }
  }, [workbenchQueues.length]);
  useEffect(() => {
    try {
      if (typeof localStorage !== "undefined") {
        if (workbenchQueueId) localStorage.setItem(WORKBENCH_QUEUE_STORAGE_KEY, workbenchQueueId);
        else localStorage.removeItem(WORKBENCH_QUEUE_STORAGE_KEY);
      }
    } catch {
      /* ignore */
    }
  }, [workbenchQueueId]);

  // Stale ?page= in the URL (or history) can point past the last page: PostgREST returns [] with a
  // non-zero Content-Range total → "N cards found" but an empty grid.
  useEffect(() => {
    if (sqlCards || !cardsResult) return;
    const { total: t, page_size } = cardsResult;
    if (typeof t !== "number" || t <= 0 || !page_size) return;
    const maxPage = Math.max(1, Math.ceil(t / page_size));
    setPage((p) => (p > maxPage ? maxPage : p));
  }, [cardsResult, sqlCards]);
  const error = cardsQueryFailed ? cardsQueryError?.message ?? "Failed to load cards" : null;
  /** Skeleton only when there is no list data yet (keeps previous page visible while paginating). */
  const listAwaitingFirstData = !sqlCards && cardsResult === undefined && cardsPending;

  useEffect(() => {
    localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filters));
  }, [filters]);

  useEffect(() => {
    if (!USE_SUPABASE_APP) {
      setSupabaseSessionIsAnonymous(false);
      return;
    }
    const sb = getSupabase();
    const apply = (session) => {
      setSupabaseSessionIsAnonymous(Boolean(session?.user?.is_anonymous));
    };
    void sb.auth.getSession().then(({ data: { session } }) => apply(session));
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => apply(session));
    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

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
          card_id: "",
          jumbo_card: "",
          weather: [],
          environment: [],
          actions: [],
          pose: [],
          annotation_field_key: "",
          annotation_field_value: "",
          sort_by: "name",
          sort_dir: "asc",
        });
        setSearchQuery("");
      }
    } else {
      const normalized = { ...newFilters };
      if (
        normalized.sort_by === "recent" &&
        !Object.prototype.hasOwnProperty.call(normalized, "sort_dir")
      ) {
        // Recent sort is most useful as newest-first by default.
        normalized.sort_dir = "desc";
      }
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

  const resetExploreFilters = useCallback(() => {
    setSearchQuery("");
    setPage(1);
    setSqlCards(null);
    setFilters({ ...DEFAULT_FILTERS });
    try {
      localStorage.removeItem(SEARCH_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    try {
      localStorage.removeItem(FILTER_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const exploreConstraintsActive = useMemo(
    () => exploreHasActiveConstraints(filters, searchQuery),
    [filters, searchQuery]
  );

  // Refresh attribute definitions after creating/deleting one.
  const handleAttributesChanged = () => {
    queryClient.invalidateQueries({ queryKey: ["attributes"] });
  };

  const handleShowInGrid = (cards) => setSqlCards(cards);

  // Dedupe so each card appears once (Explore grid):
  // - Manual: same set + name + artwork URL (legacy duplicate PKs / spaced ids vs canonical).
  // - All: trimmed `id` collisions; custom wins over API on same raw id.
  const displayedCards = useMemo(() => {
    const raw = sqlCards || cards;
    const byKey = new Map();
    const order = [];
    for (const c of raw) {
      const key = exploreGridRowDedupeKey(c);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, c);
        order.push(key);
        continue;
      }
      byKey.set(key, pickExploreGridDuplicateWinner(existing, c));
    }
    return order.map((k) => byKey.get(k));
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

  const handleToggleBatchCard = useCallback(
    (cardId) => {
      if (batchSelection.idSet.has(cardId)) batchSelection.remove(cardId);
      else {
        const ok = batchSelection.add(cardId);
        if (!ok) {
          toastWarning(
            `Batch list holds at most ${BATCH_EDIT_MAX_CARDS.toLocaleString()} cards. Remove some or clear the list.`
          );
        }
      }
    },
    [batchSelection]
  );

  const handleAddAllMatchingToBatch = useCallback(async () => {
    try {
      const { added, totalMatch, capped } = await batchSelection.selectAllMatchingExplore({
        q: searchQuery,
        ...filters,
      });
      if (totalMatch === 0) {
        toastWarning("No cards match your current search and filters.");
        return;
      }
      if (added === 0) {
        toastWarning("No new cards to add — they may already be in your batch list.");
        return;
      }
      if (capped) {
        toastWarning(
          `Added ${added.toLocaleString()} new card(s). Your filters match ${totalMatch.toLocaleString()} cards total; only the first ${BATCH_EDIT_MAX_CARDS.toLocaleString()} can be added at once — narrow filters to include the rest.`
        );
      } else {
        toastSuccess(`Added ${added.toLocaleString()} card(s) to your batch list.`);
      }
    } catch (e) {
      toastError(e);
    }
  }, [batchSelection, filters, searchQuery]);

  /** Optional toast action — stay on Explore by default; users open Workbench when ready. */
  const workbenchToastAction = useCallback(
    () => ({
      duration: 7000,
      action: {
        label: "Open Workbench",
        onClick: () => navigate("/workbench"),
      },
    }),
    [navigate]
  );

  const handleBatchListToWorkbench = useCallback(async (queueIdOverride = null) => {
    if (batchSelection.count === 0) return;
    setWorkbenchListAppendBusy(true);
    try {
      const targetQueue =
        (queueIdOverride != null
          ? workbenchQueues.find((q) => String(q.id) === String(queueIdOverride))
          : null) || selectedWorkbenchQueue || null;
      const queueId = targetQueue?.id;
      const queueName = targetQueue?.name || "Workbench";
      const { added, capped, max } = queueId
        ? await appendCardsToWorkbenchQueue(queueId, batchSelection.ids)
        : await appendCardsToDefaultQueue(batchSelection.ids);
      queryClient.invalidateQueries({ queryKey: ["workbenchQueues"] });
      if (queueId != null) setWorkbenchQueueId(String(queueId));
      if (added === 0 && capped) {
        toastWarning(
          `"${queueName}" is full (${Number(max || 5000).toLocaleString()} cards). Remove some cards before adding more.`
        );
      } else if (added === 0) {
        toastWarning(`Every card in your batch list was already in "${queueName}".`);
      } else if (capped) {
        toastWarning(
          `Added ${added.toLocaleString()} card${added === 1 ? "" : "s"} to "${queueName}". The list is capped at ${Number(max || 5000).toLocaleString()} cards; some were skipped.`
        );
      } else {
        toastSuccess(
          `Added ${added.toLocaleString()} card${added === 1 ? "" : "s"} to "${queueName}".`,
          workbenchToastAction()
        );
      }
      setShowBatchWorkbenchTargetPicker(false);
    } catch (e) {
      toastError(e);
    } finally {
      setWorkbenchListAppendBusy(false);
    }
  }, [
    batchSelection.count,
    batchSelection.ids,
    queryClient,
    selectedWorkbenchQueue?.id,
    selectedWorkbenchQueue?.name,
    workbenchQueues,
    workbenchToastAction,
  ]);

  const handleMatchingToWorkbench = useCallback(async (queueIdOverride = null) => {
    setWorkbenchMatchingAppendBusy(true);
    try {
      const { ids, totalMatch, capped: matchingCapped } = await fetchFirstNMatchingCardIds(
        { q: searchQuery, ...filters },
        BATCH_EDIT_MAX_CARDS
      );
      if (ids.length === 0) {
        toastWarning("No cards match your current search and filters.");
        return;
      }
      const targetQueue =
        (queueIdOverride != null
          ? workbenchQueues.find((q) => String(q.id) === String(queueIdOverride))
          : null) || selectedWorkbenchQueue || null;
      const queueId = targetQueue?.id;
      const queueName = targetQueue?.name || "Workbench";
      const { added, capped: queueCapped, max } = queueId
        ? await appendCardsToWorkbenchQueue(queueId, ids)
        : await appendCardsToDefaultQueue(ids);
      await queryClient.invalidateQueries({ queryKey: ["workbenchQueues"] });
      if (queueId != null) setWorkbenchQueueId(String(queueId));
      if (added === 0 && queueCapped) {
        toastWarning(
          `"${queueName}" is full (${Number(max || BATCH_EDIT_MAX_CARDS).toLocaleString()} cards). Remove some cards before adding more.`
        );
      } else if (added === 0) {
        toastWarning(`Every matching card is already in "${queueName}".`);
      } else if (queueCapped) {
        toastWarning(
          `Added ${added.toLocaleString()} matching card${added === 1 ? "" : "s"} to "${queueName}". The list is capped at ${Number(max || BATCH_EDIT_MAX_CARDS).toLocaleString()} cards; some were skipped.`
        );
      } else if (matchingCapped) {
        toastWarning(
          `Added ${added.toLocaleString()} card${added === 1 ? "" : "s"} to "${queueName}". Your filters match ${totalMatch.toLocaleString()} cards; only the first ${BATCH_EDIT_MAX_CARDS.toLocaleString()} were queued.`
        );
      } else {
        toastSuccess(
          `Added ${added.toLocaleString()} matching card${added === 1 ? "" : "s"} to "${queueName}".`,
          workbenchToastAction()
        );
      }
      setShowMatchingWorkbenchTargetPicker(false);
    } catch (err) {
      console.error(err);
      toastError(err);
    } finally {
      setWorkbenchMatchingAppendBusy(false);
    }
  }, [
    filters,
    queryClient,
    searchQuery,
    selectedWorkbenchQueue,
    workbenchQueues,
    workbenchToastAction,
  ]);

  const handleSelectedToWorkbench = useCallback(async (queueIdOverride = null) => {
    const selectedIds = Array.from(selectedCardIds);
    if (selectedIds.length === 0) return;
    setWorkbenchSelectedAppendBusy(true);
    try {
      const targetQueue =
        (queueIdOverride != null
          ? workbenchQueues.find((q) => String(q.id) === String(queueIdOverride))
          : null) || selectedWorkbenchQueue || null;
      const queueId = targetQueue?.id;
      const queueName = targetQueue?.name || "Workbench";
      const { added, capped, max } = queueId
        ? await appendCardsToWorkbenchQueue(queueId, selectedIds)
        : await appendCardsToDefaultQueue(selectedIds);
      await queryClient.invalidateQueries({ queryKey: ["workbenchQueues"] });
      if (queueId != null) setWorkbenchQueueId(String(queueId));
      if (added === 0 && capped) {
        toastWarning(
          `"${queueName}" is full (${Number(max || BATCH_EDIT_MAX_CARDS).toLocaleString()} cards). Remove some cards before adding more.`
        );
      } else if (added === 0) {
        toastWarning(`Every selected card is already in "${queueName}".`);
      } else if (capped) {
        toastWarning(
          `Added ${added.toLocaleString()} selected card${added === 1 ? "" : "s"} to "${queueName}". The list is capped at ${Number(max || BATCH_EDIT_MAX_CARDS).toLocaleString()} cards; some were skipped.`
        );
      } else {
        toastSuccess(
          `Added ${added.toLocaleString()} selected card${added === 1 ? "" : "s"} to "${queueName}".`,
          workbenchToastAction()
        );
      }
      setShowSelectedWorkbenchTargetPicker(false);
    } catch (err) {
      console.error(err);
      toastError(err);
    } finally {
      setWorkbenchSelectedAppendBusy(false);
    }
  }, [queryClient, selectedCardIds, selectedWorkbenchQueue, workbenchQueues, workbenchToastAction]);

  const handleSetToWorkbench = useCallback(
    async (setId, queueIdOverride = null) => {
      if (setToWorkbenchInFlightRef.current) return;
      const normalizedSetId = String(setId || "").trim();
      if (!normalizedSetId) {
        toastWarning("This card is missing a set id.");
        return;
      }
      setToWorkbenchInFlightRef.current = true;
      setWorkbenchMatchingAppendBusy(true);
      try {
        const { ids, totalMatch, capped: matchingCapped } = await fetchFirstNMatchingCardIds(
          { set_id: normalizedSetId },
          BATCH_EDIT_MAX_CARDS
        );
        if (ids.length === 0) {
          toastWarning("No cards found for that set.");
          return;
        }
        const targetQueue =
          (queueIdOverride != null
            ? workbenchQueues.find((q) => String(q.id) === String(queueIdOverride))
            : null) || selectedWorkbenchQueue || null;
        const queueId = targetQueue?.id;
        const queueName = targetQueue?.name || "Workbench";
        if (totalMatch >= SET_TO_WORKBENCH_CONFIRM_THRESHOLD) {
          const queuedCount = Math.min(totalMatch, BATCH_EDIT_MAX_CARDS);
          const details =
            totalMatch > BATCH_EDIT_MAX_CARDS
              ? `This set has ${totalMatch.toLocaleString()} cards. Up to the first ${BATCH_EDIT_MAX_CARDS.toLocaleString()} cards can be added at once.`
              : `This set has ${totalMatch.toLocaleString()} cards.`;
          const ok = window.confirm(
            `Add ${queuedCount.toLocaleString()} cards from set "${normalizedSetId}" to "${queueName}"?\n\n${details}`
          );
          if (!ok) return;
        }
        const { added, capped: queueCapped, max } = queueId
          ? await appendCardsToWorkbenchQueue(queueId, ids)
          : await appendCardsToDefaultQueue(ids);
        await queryClient.invalidateQueries({ queryKey: ["workbenchQueues"] });
        if (queueId != null) setWorkbenchQueueId(String(queueId));
        if (added === 0 && queueCapped) {
          toastWarning(
            `"${queueName}" is full (${Number(max || BATCH_EDIT_MAX_CARDS).toLocaleString()} cards). Remove some cards before adding more.`
          );
        } else if (added === 0) {
          toastWarning(`Every card from set "${normalizedSetId}" is already in "${queueName}".`);
        } else if (queueCapped) {
          toastWarning(
            `Added ${added.toLocaleString()} card${added === 1 ? "" : "s"} from set "${normalizedSetId}" to "${queueName}". The list is capped at ${Number(max || BATCH_EDIT_MAX_CARDS).toLocaleString()} cards; some were skipped.`
          );
        } else if (matchingCapped) {
          toastWarning(
            `Added ${added.toLocaleString()} card${added === 1 ? "" : "s"} from set "${normalizedSetId}" to "${queueName}". Set size is ${totalMatch.toLocaleString()}, so only the first ${BATCH_EDIT_MAX_CARDS.toLocaleString()} were queued.`
          );
        } else {
          toastSuccess(
            `Added ${added.toLocaleString()} card${added === 1 ? "" : "s"} from set "${normalizedSetId}" to "${queueName}".`,
            workbenchToastAction()
          );
        }
      } catch (err) {
        console.error(err);
        toastError(err);
      } finally {
        setToWorkbenchInFlightRef.current = false;
        setWorkbenchMatchingAppendBusy(false);
      }
    },
    [queryClient, selectedWorkbenchQueue, workbenchQueues, workbenchToastAction]
  );

  const handleDeleteSelected = async () => {
    setDeleteInProgress(true);
    try {
      const deleted = await deleteCardsById(selectedCardIds, { acknowledged: true });
      if (deleted.length > 0) {
        const token = getToken();
        if (token && !useSupabaseBackend()) {
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
      queryClient.invalidateQueries({ queryKey: ["cards"] });
      queryClient.invalidateQueries({ queryKey: ["filterOptions"] });
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
    if (changed.attributes) queryClient.invalidateQueries({ queryKey: ["attributes"] });
    if (changed.cards) {
      queryClient.invalidateQueries({ queryKey: ["cards"] });
      queryClient.invalidateQueries({ queryKey: ["filterOptions"] });
    }
  };

  // Refresh cards and filter options after adding a custom card.
  const handleCustomCardAdded = () => {
    queryClient.invalidateQueries({ queryKey: ["cards"] });
    queryClient.invalidateQueries({ queryKey: ["filterOptions"] });
  };

  const handleSendToWorkbench = useCallback(
    async (cardId, queueIdOverride = null) => {
      try {
        const targetQueue =
          (queueIdOverride != null
            ? workbenchQueues.find((q) => String(q.id) === String(queueIdOverride))
            : null) || selectedWorkbenchQueue || null;
        const queueId = targetQueue?.id;
        const queueName = targetQueue?.name || "Workbench";
        if (queueId != null) setWorkbenchQueueId(String(queueId));
        const { added, capped, max } = queueId
          ? await appendCardToWorkbenchQueue(queueId, cardId)
          : await appendCardToDefaultQueue(cardId);
        queryClient.invalidateQueries({ queryKey: ["workbenchQueues"] });
        if (added > 0) {
          setSelectedCardId(null);
          toastSuccess(`Card added to "${queueName}".`, workbenchToastAction());
        } else if (capped) {
          toastWarning(
            `"${queueName}" is full (${Number(max || 5000).toLocaleString()} cards). Remove some cards before adding more.`
          );
        } else {
          toastWarning(`Card is already in "${queueName}".`);
        }
      } catch (err) {
        console.error(err);
        toastError(err);
      }
    },
    [queryClient, selectedWorkbenchQueue, workbenchQueues, workbenchToastAction]
  );

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-tm-cream text-gray-900">
      {!experimentalNav ? (
        <header className="bg-tm-canopy text-white shadow-lg">
          <div className="max-w-7xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <img src={`${import.meta.env.BASE_URL}favicon.png`} alt="Tropius" className="h-14 w-14 sm:h-16 sm:w-16 shrink-0 rounded-full object-cover" />
              <h1 className="text-lg sm:text-2xl font-bold tracking-tight truncate">
                Tropius Maximus Pokemon Tracker
              </h1>
            </div>
            <nav className="flex flex-wrap items-center gap-2 order-3 sm:order-none w-full sm:w-auto justify-start sm:justify-end">
              <NavLink to="/" end className={exploreNavLinkClass}>
                Explore
              </NavLink>
              <NavLink to="/workbench" className={exploreNavLinkClass}>
                Workbench
              </NavLink>
              <NavLink to="/health" className={exploreNavLinkClass}>
                Data Health
              </NavLink>
              <NavLink to="/fields" className={exploreNavLinkClass}>
                Fields
              </NavLink>
              <NavLink
                to={{ pathname: "/batch", search: location.search }}
                className={exploreNavLinkClass}
                title="Batch edit uses your current Explore filters (same URL). Set filters first."
              >
                Batch
              </NavLink>
              <NavLink to="/history" className={exploreNavLinkClass}>
                History
              </NavLink>
            </nav>
            <div className="flex items-center gap-2 shrink-0">
              <AuthUserMenu />
              <Button
                variant="secondary"
                size="md"
                className="!text-tm-canopy border-white/40 bg-white/95 hover:bg-white"
                onClick={() => {
                  if (showSettings) {
                    setShowSettings(false);
                    setShowSqlConsole(false);
                  } else {
                    setShowSettings(true);
                  }
                }}
              >
                {showSettings ? "Close" : "Card data & tools"}
              </Button>
            </div>
          </div>
        </header>
      ) : (
        <div className="border-b border-gray-200 bg-white shadow-sm">
          <div className="max-w-7xl mx-auto px-4 py-2 flex justify-end">
            <Button
              variant="primary"
              size="md"
              onClick={() => {
                if (showSettings) {
                  setShowSettings(false);
                  setShowSqlConsole(false);
                } else {
                  setShowSettings(true);
                }
              }}
            >
              {showSettings ? "Close" : "Card data & tools"}
            </Button>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* Card data & tools panel — data source, custom cards, and SQL are sibling sections */}
        {showSettings && (
          <div className="mb-6 space-y-4">
            <p className="text-sm text-gray-600">
              Card catalog, manual entries, and optional developer tools. Custom cards are only one part of this
              panel.
            </p>

            <Card>
              <h2 className="font-semibold text-gray-800 mb-2">Data &amp; updates</h2>
              <p className="text-sm text-gray-600">
                {USE_SUPABASE_APP
                  ? "Card data is loaded from your Supabase project. API-sourced cards refresh on the ingest schedule."
                  : "Card data is updated automatically via GitHub Actions."}
              </p>
              <p className="text-xs text-gray-400 mt-2">
                Last build:{" "}
                {typeof __BUILD_DATE__ !== "undefined" ? new Date(__BUILD_DATE__).toLocaleDateString() : "unknown"}
              </p>
            </Card>

            <Card>
              <h2 className="font-semibold text-gray-800 mb-2">Custom cards</h2>
              <p className="text-xs text-gray-600 mb-3">
                {USE_SUPABASE_APP
                  ? "Add manual TCG or Pocket cards that are not in the public API. Saves go to your Supabase database (same as other catalog cards)."
                  : "Add manual TCG or Pocket cards that are not in the public API. With a GitHub PAT below, you can also sync custom_cards.json for the classic static-site workflow."}
              </p>

              {/* GitHub PAT (v1 / DuckDB only — not used for custom cards when on Supabase) */}
              {!USE_SUPABASE_APP && (
                <div ref={patSectionRef} className="mb-3 border-t border-gray-100 pt-3 space-y-1.5">
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
                          onClick={() => {
                            setToken("");
                            setGhToken("");
                            setPatSaved(false);
                          }}
                          className="text-red-500 hover:text-red-700 font-medium hover:underline"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 space-y-1">
                      <p>
                        No GitHub PAT —{" "}
                        <button
                          type="button"
                          onClick={() => setShowTokenInput(true)}
                          className="text-amber-800 font-medium hover:underline"
                        >
                          Add PAT
                        </button>{" "}
                        to sync annotations and cards across devices.
                      </p>
                      <p className="text-amber-800/90 font-normal text-[11px] leading-snug">
                        Without it, custom cards and edits stay in this browser only (DuckDB / local workflow — not
                        Supabase).
                      </p>
                    </div>
                  )}
                  {(!patSaved || showTokenInput) && <p className="text-xs text-gray-500 font-medium">Paste token here</p>}
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
                        onClick={() => {
                          setToken(ghToken);
                          setShowTokenInput(false);
                          setPatSaved(!!ghToken.trim());
                        }}
                        className="px-2 py-1 bg-gray-700 text-white rounded text-xs hover:bg-gray-800"
                      >
                        Save
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-wrap gap-2 items-center">
                <button
                  onClick={() => setShowCustomCardForm(!showCustomCardForm)}
                  className="px-3 py-1.5 bg-green-600 text-white rounded text-sm font-medium hover:bg-green-700 transition-colors"
                >
                  {showCustomCardForm ? "Hide form" : "+ Add custom card"}
                </button>
                {!USE_SUPABASE_APP && (
                  <button
                    onClick={handlePushToGitHub}
                    disabled={!ghToken || pushStatus === "pushing"}
                    className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm font-medium
                               hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {pushStatus === "pushing" ? "Pushing…" : "Push local cards to GitHub"}
                  </button>
                )}
              </div>
              {!USE_SUPABASE_APP && pushStatus === "success" && (
                <p className="mt-2 text-xs text-green-700">{pushMessage}</p>
              )}
              {!USE_SUPABASE_APP && pushStatus === "error" && (
                <p className="mt-2 text-xs text-red-600">{pushMessage}</p>
              )}
            </Card>

            <Card className="border-amber-200/90 bg-tm-warning-soft/40">
              <h2 className="font-semibold text-amber-950 mb-2">Advanced: SQL console</h2>
              <p className="text-xs text-amber-950/90 leading-relaxed mb-3">
                For developers only. Runs against the connected database (DuckDB in-browser or Supabase). Incorrect
                writes can damage data — prefer read-only queries unless you know the impact.
              </p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="!text-amber-950 border-amber-300 mb-2"
                onClick={() => setShowSqlConsole((v) => !v)}
              >
                {showSqlConsole ? "Hide SQL console" : "Open SQL console"}
              </Button>
              {showSqlConsole && (
                <div className="pt-2 border-t border-amber-200/70">
                  <SqlConsole
                    onShowInGrid={handleShowInGrid}
                    onDataChanged={handleSqlDataChanged}
                    selectedCardIds={selectedCardIds}
                  />
                </div>
              )}
            </Card>

            {/* Custom Card Form */}
            {showCustomCardForm && (
              <CustomCardForm
                onCardAdded={handleCustomCardAdded}
                onClose={() => setShowCustomCardForm(false)}
                onOpenPAT={
                  USE_SUPABASE_APP
                    ? undefined
                    : () => {
                        setShowTokenInput(true);
                        setTimeout(() => patSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
                      }
                }
                onAddAndSendToWorkbench={USE_SUPABASE_APP ? handleSendToWorkbench : undefined}
              />
            )}

            {/* AttributeManager hidden for now */}
          </div>
        )}

        {/* Search + count: sticky strip under global shell (Phase 3); full filter panel stays below */}
        {experimentalNav ? (
          <div className="-mx-4 px-4 sticky top-0 z-[15] bg-tm-cream/95 backdrop-blur-sm border-b border-gray-200/90 py-2 mb-3 shadow-sm">
            <SearchBar value={searchQuery} onChange={handleSearch} />
            {!sqlCards && (
              <div className="mt-2 text-sm text-gray-500">
                {listAwaitingFirstData ? (
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-4 w-40 rounded" />
                    <span className="sr-only">Loading results…</span>
                  </div>
                ) : (
                  `${total.toLocaleString()} card${total !== 1 ? "s" : ""} found`
                )}
              </div>
            )}
          </div>
        ) : (
          <SearchBar value={searchQuery} onChange={handleSearch} />
        )}

        {/* Filters — shell shows immediately; options fill in when the query resolves */}
        <FilterPanel
          options={filterOptions ?? EMPTY_FILTER_OPTIONS}
          filters={filters}
          onChange={handleFilterChange}
          expanded={filtersExpanded}
          onToggleExpand={() => setFiltersExpanded((prev) => !prev)}
          filterAvailability={exploreFilterAvail}
          filterUnavailableTitle={exploreFilterUnavailableTitle}
          searchQuery={searchQuery}
          onResetAll={resetExploreFilters}
        />

        {USE_SUPABASE_APP && !sqlCards && !showSqlConsole && (
          <div className="relative z-20 mb-7 mt-1">
            {batchSelection.count === 0 && !batchExploreExpanded ? (
              <div className="flex justify-start">
                <button
                  type="button"
                  onClick={() => setBatchExploreExpanded(true)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-tm-leaf/35 bg-tm-cream px-2.5 py-1.5 text-xs font-semibold text-tm-canopy shadow-sm hover:border-tm-leaf/55 hover:bg-white focus-visible:outline focus-visible:ring-2 focus-visible:ring-tm-mist/80 transition-colors"
                  aria-expanded={false}
                >
                  Batch tools
                </button>
              </div>
            ) : (
              <div className="rounded-lg border border-tm-leaf/20 bg-gradient-to-b from-white to-tm-cream/30 px-3 py-3 shadow-sm space-y-2.5 ring-1 ring-black/[0.04]">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-gray-800 min-w-0">
                    <span className="font-semibold tabular-nums text-tm-canopy">{batchSelection.count}</span>
                    <span>
                      card{batchSelection.count !== 1 ? "s" : ""} in <span className="font-medium">batch list</span>
                    </span>
                    <span className="text-xs text-gray-500">(this browser)</span>
                  </div>
                  {batchSelection.count === 0 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="shrink-0 -mr-1 -mt-0.5 text-gray-500"
                      onClick={() => setBatchExploreExpanded(false)}
                      aria-expanded
                    >
                      Hide
                    </Button>
                  ) : null}
                </div>
                <p className="text-[11px] text-gray-600 leading-relaxed">
                  <span className="text-tm-canopy font-medium">Selection:</span> checkboxes on cards while this panel is open
                  or your list is non-empty.{" "}
                  <span className="text-tm-info font-medium">Workbench:</span> separate list workflow —{" "}
                  <span className="font-medium text-gray-700">Add list to Workbench</span> appends these IDs to your selected
                  shared list (deduped).{" "}
                  <span className="text-tm-leaf font-medium">Batch edit:</span> field updates on{" "}
                  <span className="font-medium text-gray-700">Open Batch</span>.{" "}
                  <strong className="font-medium text-gray-700">Add all matching</strong> uses current search + filters (cap{" "}
                  {BATCH_EDIT_MAX_CARDS.toLocaleString()}).
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handleAddAllMatchingToBatch}
                    disabled={listAwaitingFirstData}
                    className="border-tm-leaf/25"
                  >
                    Add all matching cards
                  </Button>
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        USE_SUPABASE_APP &&
                        workbenchQueues.length > 1 &&
                        !showMatchingWorkbenchTargetPicker
                      ) {
                        setShowMatchingWorkbenchTargetPicker(true);
                        return;
                      }
                      void handleMatchingToWorkbench(selectedWorkbenchQueue?.id ?? undefined);
                    }}
                    disabled={workbenchMatchingAppendBusy}
                    title="Add cards matching current filters to your selected Workbench list (deduped; capped at 5,000)"
                    className="inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-sm font-semibold text-white shadow-sm bg-tm-info hover:brightness-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:brightness-100"
                  >
                    {workbenchMatchingAppendBusy ? "Adding…" : "Add matching to Workbench"}
                  </button>
                  {showMatchingWorkbenchTargetPicker && USE_SUPABASE_APP && workbenchQueues.length > 1 && (
                    <div className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-white px-1.5 py-1">
                      <select
                        value={selectedWorkbenchQueue?.id ?? ""}
                        onChange={(e) => setWorkbenchQueueId(String(e.target.value))}
                        className="h-8 rounded border border-sky-300 bg-white px-2 text-xs text-sky-950"
                      >
                        {workbenchQueues.map((q) => (
                          <option key={q.id} value={q.id}>
                            {q.name || "Untitled list"}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => void handleMatchingToWorkbench(selectedWorkbenchQueue?.id ?? undefined)}
                        className="h-8 rounded bg-tm-info px-2.5 text-xs font-semibold text-white hover:brightness-95"
                      >
                        Add
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowMatchingWorkbenchTargetPicker(false)}
                        className="h-8 rounded border border-gray-300 bg-white px-2.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        USE_SUPABASE_APP &&
                        workbenchQueues.length > 1 &&
                        !showBatchWorkbenchTargetPicker
                      ) {
                        setShowBatchWorkbenchTargetPicker(true);
                        return;
                      }
                      void handleBatchListToWorkbench(selectedWorkbenchQueue?.id ?? undefined);
                    }}
                    disabled={batchSelection.count === 0 || workbenchListAppendBusy}
                    title="Add your saved batch list to the selected Workbench list (deduped; does not replace the list)"
                    className="inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-sm font-semibold text-white shadow-sm bg-tm-info hover:brightness-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:brightness-100"
                  >
                    {workbenchListAppendBusy ? "Adding…" : "Add list to Workbench"}
                  </button>
                  {showBatchWorkbenchTargetPicker && USE_SUPABASE_APP && workbenchQueues.length > 1 && (
                    <div className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-white px-1.5 py-1">
                      <select
                        value={selectedWorkbenchQueue?.id ?? ""}
                        onChange={(e) => setWorkbenchQueueId(String(e.target.value))}
                        className="h-8 rounded border border-sky-300 bg-white px-2 text-xs text-sky-950"
                      >
                        {workbenchQueues.map((q) => (
                          <option key={q.id} value={q.id}>
                            {q.name || "Untitled list"}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => void handleBatchListToWorkbench(selectedWorkbenchQueue?.id ?? undefined)}
                        className="h-8 rounded bg-tm-info px-2.5 text-xs font-semibold text-white hover:brightness-95"
                      >
                        Add
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowBatchWorkbenchTargetPicker(false)}
                        className="h-8 rounded border border-gray-300 bg-white px-2.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                  <NavLink
                    to="/batch"
                    className="inline-flex items-center justify-center rounded-lg bg-tm-leaf px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-tm-leaf-muted"
                  >
                    Open Batch
                  </NavLink>
                  <span
                    className="hidden sm:inline-block w-px h-6 bg-gray-200 mx-0.5 self-center shrink-0"
                    aria-hidden
                  />
                  <button
                    type="button"
                    onClick={() => batchSelection.clear()}
                    disabled={batchSelection.count === 0}
                    title="Remove every card from your saved batch list (does not delete cards)"
                    className="inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-sm font-semibold border border-tm-danger/45 bg-tm-danger-soft text-tm-danger shadow-sm hover:bg-red-200/90 hover:border-tm-danger/55 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-tm-danger-soft"
                  >
                    Clear batch list
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Results count (legacy header layout only — shell uses sticky strip above) */}
        {!experimentalNav && !sqlCards && (
          <div className="mt-4 mb-2 text-sm text-gray-500">
            {listAwaitingFirstData
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
        {(selectedCardIds.size > 0 || sqlCards) && (
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
              type="button"
              onClick={() => {
                if (USE_SUPABASE_APP && workbenchQueues.length > 1 && !showSelectedWorkbenchTargetPicker) {
                  setShowSelectedWorkbenchTargetPicker(true);
                  return;
                }
                void handleSelectedToWorkbench(selectedWorkbenchQueue?.id ?? undefined);
              }}
              disabled={selectedCardIds.size === 0 || workbenchSelectedAppendBusy}
              title="Add selected cards to your selected Workbench list (deduped; capped at 5,000)"
              className="text-sm font-medium px-3 py-1 rounded bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {workbenchSelectedAppendBusy ? "Adding…" : "Add selected to Workbench"}
            </button>
            {showSelectedWorkbenchTargetPicker && USE_SUPABASE_APP && workbenchQueues.length > 1 && (
              <div className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-white px-1.5 py-1">
                <select
                  value={selectedWorkbenchQueue?.id ?? ""}
                  onChange={(e) => setWorkbenchQueueId(String(e.target.value))}
                  className="h-8 rounded border border-sky-300 bg-white px-2 text-xs text-sky-950"
                >
                  {workbenchQueues.map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.name || "Untitled list"}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void handleSelectedToWorkbench(selectedWorkbenchQueue?.id ?? undefined)}
                  className="h-8 rounded bg-sky-600 px-2.5 text-xs font-semibold text-white hover:bg-sky-700"
                >
                  Add
                </button>
                <button
                  type="button"
                  onClick={() => setShowSelectedWorkbenchTargetPicker(false)}
                  className="h-8 rounded border border-gray-300 bg-white px-2.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            )}
            <button
              onClick={() => setShowDeleteConfirm(true)}
              disabled={selectedCardIds.size === 0}
              className="ml-auto text-sm font-medium px-3 py-1 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Delete Selected Card{selectedCardIds.size !== 1 ? "s" : ""}
            </button>
          </div>
        )}

        {/* Annotation sync banner (GitHub / DuckDB only — not used when data lives in Supabase) */}
        {!USE_SUPABASE_APP &&
          (syncStatus === "syncing" ||
            syncStatus === "done" ||
            syncStatus === "building" ||
            syncStatus === "deployed" ||
            syncStatus === "deploy_failed" ||
            syncStatus === "error" ||
            (syncStatus === "idle" && pendingSyncCardIds.length > 0)) && (
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
          const useSb = USE_SUPABASE_APP;
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
              <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4">
                <h2 className="text-lg font-semibold text-gray-900 mb-3">Delete Cards?</h2>

                {customCount > 0 && (
                  <p className="text-sm text-gray-700 mb-2">
                    <span className="font-semibold text-red-600">{customCount}</span> custom card
                    {customCount !== 1 ? "s" : ""} will be permanently deleted
                    {useSb
                      ? " from the database."
                      : hasToken
                        ? " from this browser and from GitHub."
                        : " from this browser only. Add a GitHub PAT in Settings to also remove from GitHub."}
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
            loading={sqlCards ? false : listAwaitingFirstData}
            onCardClick={(id) => setSelectedCardId(id)}
            selectedCardIds={
              showSqlConsole
                ? selectedCardIds
                : batchModeActive
                  ? batchSelection.idSet
                  : EMPTY_SELECTED_CARD_IDS
            }
            onToggleSelection={
              showSqlConsole
                ? handleToggleCardSelection
                : batchModeActive
                  ? handleToggleBatchCard
                  : null
            }
            onResetExplore={resetExploreFilters}
            showResetWhenEmpty={!sqlCards && exploreConstraintsActive}
            anonymousRlsBlocked={USE_SUPABASE_APP && supabaseSessionIsAnonymous}
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
                queryClient.invalidateQueries({ queryKey: ["cards"] });
                queryClient.invalidateQueries({ queryKey: ["filterOptions"] });
              }}
              hasPrev={currentIndex > 0}
              hasNext={currentIndex < cardIds.length - 1}
              onPrev={() => setSelectedCardId(cardIds[currentIndex - 1])}
              onNext={() => setSelectedCardId(cardIds[currentIndex + 1])}
              onFilterClick={(filterKey, filterValue) => {
                setSelectedCardId(null);
                setPage(1);
                if (filterKey === "q") {
                  setSearchQuery(String(filterValue ?? ""));
                  setFilters({ ...DEFAULT_FILTERS });
                  return;
                }
                if (String(filterKey).startsWith("annotation:")) {
                  const fieldKey = String(filterKey).slice("annotation:".length).trim();
                  if (!fieldKey) return;
                  setSearchQuery("");
                  setFilters({
                    ...DEFAULT_FILTERS,
                    annotation_field_key: fieldKey,
                    annotation_field_value: String(filterValue ?? "").trim(),
                  });
                  return;
                }
                setSearchQuery("");
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
              onSendToWorkbench={USE_SUPABASE_APP ? handleSendToWorkbench : undefined}
              onSendSetToWorkbench={USE_SUPABASE_APP ? handleSetToWorkbench : undefined}
              isSetToWorkbenchBusy={USE_SUPABASE_APP ? workbenchMatchingAppendBusy : false}
              workbenchQueueOptions={USE_SUPABASE_APP ? workbenchQueues : []}
              selectedWorkbenchQueueId={selectedWorkbenchQueue?.id ?? ""}
              onWorkbenchQueueChange={USE_SUPABASE_APP ? (id) => setWorkbenchQueueId(String(id)) : undefined}
              inBatchList={USE_SUPABASE_APP ? batchSelection.isInBatch(selectedCardId) : false}
              onAddToBatchList={
                USE_SUPABASE_APP
                  ? () => {
                      const ok = batchSelection.add(selectedCardId);
                      if (!ok) {
                        toastWarning(
                          `Batch list holds at most ${BATCH_EDIT_MAX_CARDS.toLocaleString()} cards. Remove some or clear the list.`
                        );
                      } else {
                        toastSuccess("Added to batch list.");
                      }
                    }
                  : undefined
              }
              onRemoveFromBatchList={
                USE_SUPABASE_APP
                  ? () => {
                      batchSelection.remove(selectedCardId);
                      toastSuccess("Removed from batch list.");
                    }
                  : undefined
              }
            />
            </CardDetailErrorBoundary>
          );
        })()}
      </main>
    </div>
  );
}
