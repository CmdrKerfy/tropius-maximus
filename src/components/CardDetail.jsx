/**
 * CardDetail — Modal overlay showing full card information.
 *
 * Fetches the complete card data (including raw API payload and annotations)
 * when opened. Displays the large card image, key stats, attacks, weaknesses,
 * and editable Annotations / Video / Notes sections matching the Add a Card form.
 *
 * Closes when clicking the backdrop or pressing Escape.
 */

import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Image as ImageIcon, Pencil, Plus, Share2, X } from "lucide-react";
import {
  fetchCard,
  patchAnnotations,
  fetchFormOptions,
  FORM_OPTIONS_QUERY_KEY,
  exportAllAnnotations,
  deleteCardsById,
  useSupabaseBackend,
  fetchUserPreferences,
  upsertUserPreferences,
  fetchProfile,
} from "../db";
import CardAttributionLine from "./CardAttributionLine.jsx";
import CardDetailFieldControl from "./CardDetailFieldControl.jsx";
import CardDetailPinEditor from "./CardDetailPinEditor.jsx";
import { normalizeCardDetailPins } from "../lib/cardDetailPinRegistry.js";
import { getToken, getAnnotationsFileContents, updateAnnotationsFileContents, deleteCardsFromGitHub } from "../lib/github";
import ComboBox from "./ComboBox";
import MultiComboBox from "./MultiComboBox";
import FormFieldLabel from "./ui/FormFieldLabel.jsx";
import { splitUiLabel } from "../lib/splitUiLabel.js";
import { toastError, toastSuccess } from "../lib/toast.js";
import { humanizeError } from "../lib/humanizeError.js";
import { fixDisplayText, sanitizeCardRawDataForDisplay } from "../lib/fixUtf8Mojibake.js";
import { formatEvolutionLineLabel, normalizeEvolutionLineOptions } from "../lib/evolutionLineFormat.js";
import { shouldRefreshFormOptionsForAnnotationKey } from "../lib/formOptionsRefreshKeys.js";
import {
  CARD_SUBCATEGORY_OPTIONS, HELD_ITEM_OPTIONS, POKEBALL_OPTIONS,
  EVOLUTION_ITEMS_OPTIONS, BERRIES_OPTIONS, HOLIDAY_THEME_OPTIONS,
  MULTI_CARD_OPTIONS, TRAINER_CARD_TYPE_OPTIONS, TRAINER_CARD_SUBGROUP_OPTIONS,
  VIDEO_TYPE_OPTIONS, TOP_10_THEMES_OPTIONS, WTPC_EPISODE_OPTIONS,
  VIDEO_REGION_OPTIONS, VIDEO_LOCATION_OPTIONS, STAMP_OPTIONS,
  CARD_BORDER_OPTIONS, ENERGY_TYPE_OPTIONS, RIVAL_GROUP_OPTIONS,
  ADDITIONAL_CHARACTER_THEME_OPTIONS,
} from "../lib/annotationOptions";

const COLOR_OPTIONS = [
  "black", "blue", "brown", "gray", "green", "pink", "purple", "red", "white", "yellow",
];
const TCG_TYPE_OPTIONS = [
  "Colorless", "Darkness", "Dragon", "Fairy", "Fighting", "Fire",
  "Grass", "Lightning", "Metal", "Psychic", "Water",
];
const SHAPE_OPTIONS = [
  "ball", "squiggle", "fish", "arms", "blob", "upright", "legs",
  "quadruped", "wings", "tentacles", "heads", "humanoid", "bug-wings", "armor",
];
const VIDEO_GAME_OPTIONS = [
  "Red/Blue", "Gold/Silver", "Ruby/Sapphire", "FireRed/LeafGreen",
  "Diamond/Pearl", "Platinum", "HeartGold/SoulSilver",
  "Black/White", "Black 2/White 2", "X/Y", "Omega Ruby/Alpha Sapphire",
  "Sun/Moon", "Ultra Sun/Ultra Moon", "Let's Go Pikachu/Eevee",
  "Sword/Shield", "Brilliant Diamond/Shining Pearl",
  "Legends Arceus", "Scarlet/Violet", "Other",
];

const MULTI_VALUE_ANNOTATION_KEYS = new Set([
  "art_style", "main_character", "background_pokemon", "background_humans",
  "additional_characters", "background_details", "additional_character_theme",
  "card_subcategory", "trainer_card_subgroup", "evolution_items",
  "berries", "holiday_theme", "multi_card",
  "video_game", "video_game_location", "video_title", "video_type", "top_10_themes", "wtpc_episode",
  "video_region", "video_location",
  "pose", "emotion", "actions",
  "items", "held_item", "pokeball",
  "types",
]);

/**
 * CollapsibleSection — A reusable component for collapsible content areas.
 */
function CollapsibleSection({ title, defaultOpen = true, children }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-3 shadow-sm">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 w-full text-left rounded-md py-1 -my-1 px-1 -mx-1 hover:bg-white/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tm-mist/80"
      >
        <ChevronRight
          className={`w-4 h-4 text-gray-500 transition-transform shrink-0 ${isOpen ? "rotate-90" : ""}`}
          strokeWidth={2}
          aria-hidden
        />
        <h3 className="font-semibold text-gray-800 text-sm sm:text-base">{title}</h3>
      </button>
      {isOpen && <div className="mt-3 pt-3 border-t border-gray-200/90">{children}</div>}
    </div>
  );
}

function parseAnnotations(card) {
  if (!card?.annotations) return {};
  const a = card.annotations;
  if (typeof a === "string") {
    try {
      return JSON.parse(a);
    } catch {
      return {};
    }
  }
  return a;
}

export default function CardDetail({
  cardId,
  attributes,
  source = "TCG",
  onClose,
  onCardDeleted,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onFilterClick,
  onSyncQueued,
  onSyncStarted,
  onSyncCompleted,
  onSyncFailed,
  onRegisterSyncRunner,
  workflowBuildingRef,
  onSendToWorkbench,
  inBatchList = false,
  onAddToBatchList,
  onRemoveFromBatchList,
}) {
  const queryClient = useQueryClient();
  const cardDetailQueryKey = useMemo(() => ["cardDetail", cardId, source], [cardId, source]);
  const {
    data: card = null,
    isPending: cardPending,
    isError: cardFetchFailed,
    error: cardFetchError,
  } = useQuery({
    queryKey: cardDetailQueryKey,
    queryFn: () => fetchCard(cardId, source),
    enabled: Boolean(cardId),
    staleTime: 60_000,
  });
  const loading = cardPending;
  const error = cardFetchFailed ? cardFetchError?.message ?? "Failed to load card" : null;
  const [editingImage, setEditingImage] = useState(false);
  const [newImageUrl, setNewImageUrl] = useState("");
  const [savingImage, setSavingImage] = useState(false);
  const [imageEnlarged, setImageEnlarged] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteInProgress, setDeleteInProgress] = useState(false);
  const [activeTab, setActiveTab] = useState("info");
  const [pinEditorOpen, setPinEditorOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null); // null | "saving" | "saved" | "error"
  const [saveMessage, setSaveMessage] = useState("");
  /** Supabase: per-field / image_override saves — visible status next to Done (not only console). */
  const [annSaveUi, setAnnSaveUi] = useState({
    phase: "idle",
    savedAt: null,
    errorDetail: null,
  });
  const annPendingRef = useRef(0);
  const annSaveClearTimerRef = useRef(null);
  const [syncRetryCount, setSyncRetryCount] = useState(0);
  const ghPushTimer = useRef(null);
  const ghPushInProgressRef = useRef(false); // prevents duplicate commits while one is in flight
  const runSyncNowRef = useRef(null);

  const { data: userPrefs } = useQuery({
    queryKey: ["userPreferences"],
    queryFn: fetchUserPreferences,
    staleTime: 30_000,
  });

  const { data: myProfile } = useQuery({
    queryKey: ["profile", "me"],
    queryFn: fetchProfile,
    staleTime: 60_000,
    enabled: useSupabaseBackend(),
  });

  const { data: formOpts = {} } = useQuery({
    queryKey: FORM_OPTIONS_QUERY_KEY,
    queryFn: fetchFormOptions,
    staleTime: 300_000,
  });

  const normalizedCardDetailPins = useMemo(
    () => normalizeCardDetailPins(userPrefs?.card_detail_pins),
    [userPrefs?.card_detail_pins]
  );

  const savePinsMutation = useMutation({
    mutationFn: (pins) => upsertUserPreferences({ card_detail_pins: pins }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["userPreferences"] });
      setPinEditorOpen(false);
    },
  });

  // When the modal switches card or source, reset transient UI (card body comes from TanStack Query).
  useEffect(() => {
    setImageEnlarged(false);
    setEditingImage(false);
    setSaveStatus(null);
    setSaveMessage("");
    setAnnSaveUi({ phase: "idle", savedAt: null, errorDetail: null });
    clearTimeout(annSaveClearTimerRef.current);
    setSyncRetryCount(0);
  }, [cardId, source]);

  // Supabase: when returning to the tab, refresh the card if not mid-edit (reduces stale detail after time away).
  useEffect(() => {
    if (!useSupabaseBackend()) return undefined;
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      if (isEditMode || editingImage || loading || imageEnlarged) return;
      void queryClient.invalidateQueries({ queryKey: cardDetailQueryKey });
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [cardId, source, isEditMode, editingImage, loading, imageEnlarged, queryClient, cardDetailQueryKey]);

  // Keyboard navigation: Escape, ArrowLeft, ArrowRight.
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") {
        if (imageEnlarged) {
          setImageEnlarged(false);
        } else {
          handleClose();
        }
      }
      if (!imageEnlarged && !editingImage) {
        if (e.key === "ArrowLeft" && hasPrev) {
          onPrev();
        } else if (e.key === "ArrowRight" && hasNext) {
          onNext();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleClose, imageEnlarged, editingImage, hasPrev, hasNext, onPrev, onNext]);

  // Prevent body scroll while modal is open.
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  // Parse JSON strings that might be in the raw_data.
  const parseJson = (val) => {
    if (typeof val === "string") {
      try {
        return JSON.parse(val);
      } catch {
        return val;
      }
    }
    return val;
  };

  // Extract useful data from the raw API payload (guard empty string — invalid JSON).
  // Clone + sanitize so we never mutate TanStack cache; fix mojibake in flavor/rules/attacks/abilities.
  let raw = null;
  if (card) {
    if (typeof card.raw_data === "string") {
      try {
        raw = card.raw_data.trim() ? JSON.parse(card.raw_data) : null;
      } catch {
        raw = null;
      }
    } else if (card.raw_data && typeof card.raw_data === "object") {
      raw = { ...card.raw_data };
    } else {
      raw = null;
    }
    if (raw) raw = sanitizeCardRawDataForDisplay(raw);
  }
  const attacks = raw?.attacks || [];
  const weaknesses = raw?.weaknesses || [];
  const resistances = raw?.resistances || [];
  const retreatCost = raw?.retreatCost || [];
  const abilities = raw?.abilities || [];
  const rules = raw?.rules || [];
  const subtypes = card ? parseJson(card.subtypes) : [];
  const types = card ? parseJson(card.types) : [];

  const ann = card ? parseAnnotations(card) : {};
  const annotationEditorDisplayName = useMemo(() => {
    if (!card) return null;
    const uid = parseAnnotations(card).updated_by;
    if (uid && myProfile?.id === uid) return myProfile.display_name ?? null;
    return card.annotation_editor_display_name ?? null;
  }, [card, myProfile]);
  const opts = formOpts || {};
  // Ensure ComboBox/MultiComboBox always receive an array (avoid .filter on non-array).
  const optArr = (v) => (Array.isArray(v) ? v : []);
  const inputClass =
    "w-full px-3 py-1.5 border border-gray-300 rounded text-sm " +
    "focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent";
  useEffect(
    () => () => {
      clearTimeout(ghPushTimer.current);
      clearTimeout(annSaveClearTimerRef.current);
    },
    []
  );

  /**
   * Wraps Supabase annotation writes so Explore inline edits show saving / saved / error like Workbench.
   */
  async function withSupabaseAnnotationSave(work) {
    annPendingRef.current += 1;
    setAnnSaveUi((s) => ({ ...s, phase: "saving", errorDetail: null }));
    let succeeded = false;
    try {
      const result = await work();
      succeeded = true;
      return result;
    } catch (err) {
      console.error(err);
      toastError(err);
      setAnnSaveUi({ phase: "error", savedAt: null, errorDetail: humanizeError(err) });
      throw err;
    } finally {
      annPendingRef.current = Math.max(0, annPendingRef.current - 1);
      if (annPendingRef.current === 0 && succeeded) {
        const at = new Date();
        setAnnSaveUi({ phase: "saved", savedAt: at, errorDetail: null });
        clearTimeout(annSaveClearTimerRef.current);
        annSaveClearTimerRef.current = setTimeout(() => {
          setAnnSaveUi({ phase: "idle", savedAt: null, errorDetail: null });
        }, 4000);
      }
    }
  }

  // Debounce GitHub push so a quick pass through many cards produces one commit and one workflow run.
  const GITHUB_PUSH_DEBOUNCE_MS = 5000;
  const GITHUB_PUSH_RETRY_WHEN_BUSY_MS = 2000; // if a push is in progress, retry after this

  // Push annotations to GitHub; retries up to 4 times on 409 (workflow may be mid-commit).
  const pushAnnotationsToGitHub = async (token, allAnnotations, commitMessage) => {
    const MAX_SHA_RETRIES = 4;
    for (let attempt = 0; attempt < MAX_SHA_RETRIES; attempt++) {
      const { sha } = await getAnnotationsFileContents(token);
      try {
        return await updateAnnotationsFileContents(token, allAnnotations, sha, commitMessage);
      } catch (err) {
        if (err?.message?.includes("409") && attempt < MAX_SHA_RETRIES - 1) {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        throw err;
      }
    }
  };

  const runScheduledPush = async (autoRetryCount = 0) => {
    if (useSupabaseBackend()) return;
    const token = getToken();
    if (!token) return;
    if (ghPushInProgressRef.current) {
      // Another push is in progress (e.g. user edited another card). Retry shortly so no edits are lost.
      ghPushTimer.current = setTimeout(() => runScheduledPush(autoRetryCount), GITHUB_PUSH_RETRY_WHEN_BUSY_MS);
      return;
    }
    if (workflowBuildingRef?.current) {
      // A GitHub build is in progress — hold the push until it finishes to avoid SHA conflicts.
      // startWorkflowPolling will call syncRunnerRef when done; this timer is the fallback.
      ghPushTimer.current = setTimeout(() => runScheduledPush(autoRetryCount), 10000);
      return;
    }
    ghPushInProgressRef.current = true;
    setSaveStatus("saving");
    setSaveMessage("");
    if (autoRetryCount === 0) onSyncStarted?.();
    try {
      const allAnnotations = await exportAllAnnotations();
      const pushResult = await pushAnnotationsToGitHub(
        token,
        allAnnotations,
        "CardDetail: update annotations"
      );
      setSaveStatus("saved");
      setSaveMessage("Submitted to GitHub.");
      onSyncCompleted?.(Object.keys(allAnnotations), pushResult?.commit?.sha);
      setTimeout(() => { setSaveStatus(null); setSaveMessage(""); }, 3500);
    } catch (err) {
      console.warn("CardDetail GitHub push failed:", err.message);
      const msg = err?.message || "";
      const is403 = msg.includes("403");
      if (!is403 && autoRetryCount < 8) {
        // Transient failure (GitHub busy / workflow in progress) — retry silently.
        ghPushInProgressRef.current = false;
        ghPushTimer.current = setTimeout(() => runScheduledPush(autoRetryCount + 1), 15000);
        return;
      }
      setSaveStatus("error");
      setSaveMessage(is403 ? "Couldn't sync — check your token in Settings." : "Couldn't sync to GitHub.");
      onSyncFailed?.(is403);
    } finally {
      ghPushInProgressRef.current = false;
    }
  };

  const scheduleGitHubPush = () => {
    if (useSupabaseBackend()) return;
    const token = getToken();
    if (!token) return;
    if (card?.id && onSyncQueued) onSyncQueued(card.id);
    setSaveStatus("queued");
    setSaveMessage(workflowBuildingRef?.current ? "Saved locally. Will sync after build." : "Saved locally. Syncing soon…");
    clearTimeout(ghPushTimer.current);
    ghPushTimer.current = setTimeout(runScheduledPush, GITHUB_PUSH_DEBOUNCE_MS);
  };

  const runSyncNow = async (autoRetryCount = 0) => {
    if (useSupabaseBackend()) {
      if (autoRetryCount === 0) {
        setIsEditMode(false);
        setActiveTab("info");
      }
      setSaveStatus("saved");
      setSaveMessage("Changes are stored in the database.");
      setTimeout(() => {
        setSaveStatus(null);
        setSaveMessage("");
      }, 3500);
      return;
    }
    if (ghPushInProgressRef.current) {
      if (card?.id && onSyncQueued) onSyncQueued(card.id);
      setSaveStatus("queued");
      setSaveMessage("Saved locally. Syncing soon…");
      clearTimeout(ghPushTimer.current);
      ghPushTimer.current = setTimeout(runScheduledPush, GITHUB_PUSH_RETRY_WHEN_BUSY_MS);
      return;
    }
    ghPushInProgressRef.current = true;
    clearTimeout(ghPushTimer.current);
    if (card?.id && onSyncQueued) onSyncQueued(card.id);
    setSaveStatus("saving");
    setSaveMessage("");
    if (autoRetryCount === 0) {
      setIsEditMode(false);
      setActiveTab("info");
      onSyncStarted?.();
    }
    try {
      const allAnnotations = await exportAllAnnotations();
      const token = getToken();
      if (token) {
        const pushResult = await pushAnnotationsToGitHub(
          token,
          allAnnotations,
          "Sync annotations"
        );
        setSaveStatus("saved");
        setSaveMessage("Submitted to GitHub.");
        onSyncCompleted?.(Object.keys(allAnnotations), pushResult?.commit?.sha);
        setTimeout(() => { setSaveStatus(null); setSaveMessage(""); }, 3500);
      } else {
        setSaveStatus("saved");
        setSaveMessage("Saved locally.");
        setTimeout(() => { setSaveStatus(null); setSaveMessage(""); }, 3500);
      }
    } catch (err) {
      const msg = err.message || "";
      const is403 = msg.includes("403");
      if (!is403 && autoRetryCount < 8) {
        // Transient failure — retry silently while keeping "Syncing…" visible.
        ghPushInProgressRef.current = false;
        ghPushTimer.current = setTimeout(() => runSyncNow(autoRetryCount + 1), 15000);
        return;
      }
      setSaveStatus("error");
      setSaveMessage(is403 ? "Couldn't sync — check your token in Settings." : "Couldn't sync to GitHub.");
      onSyncFailed?.(is403);
    } finally {
      ghPushInProgressRef.current = false;
    }
  };

  const handleSaveChanges = runSyncNow;
  runSyncNowRef.current = runSyncNow;

  // So banner Retry can trigger sync (works even after modal closes — exports all annotations).
  useEffect(() => {
    onRegisterSyncRunner?.(() => runSyncNowRef.current?.());
  }, [onRegisterSyncRunner]);

  function handleClose() {
    if (ghPushTimer.current) {
      clearTimeout(ghPushTimer.current);
      ghPushTimer.current = null;
      if (!useSupabaseBackend()) {
        if (card?.id && onSyncQueued) onSyncQueued(card.id);
        runScheduledPush();
      }
    }
    onClose();
  }

  const saveAnnotation = async (key, value) => {
    let stored = value;
    if (MULTI_VALUE_ANNOTATION_KEYS.has(key) && typeof value === "string") {
      stored = value ? value.split(",").map((s) => s.trim()).filter(Boolean) : [];
    }
    if (key === "background_pokemon" && Array.isArray(stored)) {
      stored = stored.map((s) => s.toLowerCase());
    }
    const run = async () => {
      // Optimistic UI: reflect field edits immediately in the detail form while save is in flight.
      queryClient.setQueryData(cardDetailQueryKey, (prev) => {
        if (!prev) return prev;
        const prevAnn = parseAnnotations(prev);
        const nextAnn = { ...prevAnn };
        if (stored === null || stored === undefined || stored === "") delete nextAnn[key];
        else nextAnn[key] = stored;
        return { ...prev, annotations: nextAnn };
      });
      const updatedFlat = await patchAnnotations(card.id, { [key]: stored });
      queryClient.setQueryData(cardDetailQueryKey, (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          annotations: useSupabaseBackend() ? updatedFlat : { ...parseAnnotations(prev), [key]: stored },
        };
      });
      if (useSupabaseBackend() && shouldRefreshFormOptionsForAnnotationKey(key)) {
        queryClient.invalidateQueries({ queryKey: FORM_OPTIONS_QUERY_KEY });
      }
      if (!useSupabaseBackend()) scheduleGitHubPush();
      return updatedFlat;
    };
    try {
      if (useSupabaseBackend()) {
        await withSupabaseAnnotationSave(run);
      } else {
        await run();
      }
    } catch (err) {
      if (!useSupabaseBackend()) {
        console.error("Failed to save annotation:", err);
      } else {
        void (async () => {
          try {
            const fresh = await fetchCard(cardId, source);
            queryClient.setQueryData(cardDetailQueryKey, fresh);
          } catch (e) {
            const m = String(e?.message ?? e ?? "").toLowerCase();
            if (/not found|pgrst116|could not find|0 rows/i.test(m)) {
              onClose?.();
            }
          }
        })();
      }
    }
  };

  const handleDeleteCard = async () => {
    setDeleteInProgress(true);
    try {
      const deleted = await deleteCardsById([card.id]);
      if (deleted.length === 0) {
        toastError(
          "This card could not be deleted. Only manually added cards can be removed, or you may need permission to delete."
        );
        return;
      }
      if (deleted.length > 0 && getToken() && !useSupabaseBackend()) {
        try {
          await deleteCardsFromGitHub(getToken(), deleted);
        } catch (e) {
          console.warn(e);
        }
      }
      setShowDeleteConfirm(false);
      onCardDeleted?.();
    } finally {
      setDeleteInProgress(false);
    }
  };

  const annValue = (key, multi = false) => {
    const v = ann[key];
    if (multi && Array.isArray(v)) return v.join(", ");
    if (v === null || v === undefined) return "";
    return String(v);
  };

  const renderAnnotationView = () => {
    const mapLabelToFilter = (label, rawValue) => {
      if (!onFilterClick) return null;
      const val = typeof rawValue === "string" ? rawValue.trim() : String(rawValue ?? "").trim();
      if (!val) return null;
      const splitVals = val
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      switch (label) {
        case "Type":
          return { filterKey: "element", values: splitVals };
        case "Rarity":
          return { filterKey: "rarity", values: splitVals };
        case "Evolution Line":
          return { filterKey: "evolution_line", values: [val] };
        case "Featured Region":
          return { filterKey: "region", values: splitVals };
        case "Weather":
          return { filterKey: "weather", values: splitVals };
        case "Environment":
          return { filterKey: "environment", values: splitVals };
        case "Actions":
          return { filterKey: "actions", values: splitVals };
        case "Pose":
          return { filterKey: "pose", values: splitVals };
        case "Background Pokémon":
          return { filterKey: "background_pokemon", values: splitVals.map((x) => x.toLowerCase()) };
        case "Set Name":
          return card?.set_id ? { filterKey: "set_id", values: [String(card.set_id)] } : { filterKey: "q", values: [val] };
        default:
          return { filterKey: "q", values: [val] };
      }
    };

    const field = (label, value) => {
      if (value === null || value === undefined || value === "" || value === false) return null;
      const { primary, secondary } = splitUiLabel(label);
      const isBool = value === true;
      const display =
        isBool ? "Yes" : typeof value === "string" ? fixDisplayText(value) : value;
      const target = isBool ? null : mapLabelToFilter(label, String(display));
      const pieces =
        target && target.values.length > 1
          ? target.values
          : [String(display)];
      return (
        <div key={label} className="flex gap-2 text-sm min-w-0">
          <span className="text-gray-500 shrink-0 max-w-[min(100%,11rem)] leading-snug">
            <span className="break-words">{primary}</span>
            {secondary ? (
              <span className="block text-xs text-gray-400 font-normal break-words">{secondary}</span>
            ) : null}
            :
          </span>
          <span className="text-gray-900 min-w-0 break-words">
            {target ? (
              pieces.map((p, idx) => (
                <span key={`${label}-${p}-${idx}`}>
                  <button
                    type="button"
                    onClick={() => onFilterClick(target.filterKey, p)}
                    className="text-left underline decoration-dotted underline-offset-2 hover:text-green-700"
                    title={`Find cards with ${p}`}
                  >
                    {p}
                  </button>
                  {idx < pieces.length - 1 ? ", " : ""}
                </span>
              ))
            ) : (
              display
            )}
          </span>
        </div>
      );
    };

    const sectionHeader = (title) => (
      <div className="col-span-full text-xs font-semibold uppercase tracking-wide text-gray-400 pt-3 border-t first:pt-0 first:border-t-0">
        {title}
      </div>
    );

    const sections = [
      {
        title: "Mon Classification",
        fields: [
          field("Set Name", annValue("set_name")),
          field("Rarity", annValue("rarity")),
          field("Type", annValue("types", true)),
          field("Unique ID", annValue("unique_id")),
          field("Card Subcategory", annValue("card_subcategory", true)),
          field("Evolution Line", annValue("evolution_line")),
          field("Card Border Color", annValue("card_border")),
          field("Stamp", annValue("stamp")),
        ],
      },
      {
        title: "Other Card Classification",
        fields: [
          field("Trainer Card Type", annValue("trainer_card_type")),
          field("Trainer Card Subgroup", annValue("trainer_card_subgroup", true)),
          field("Energy Card Type", annValue("energy_type")),
        ],
      },
      {
        title: "Scene & Setting",
        fields: [
          field("Featured Region", annValue("pkmn_region")),
          field("Card Location", annValue("card_locations")),
          field("Environment", annValue("environment")),
          field("Weather", annValue("weather")),
          field("Background Details", annValue("background_details", true)),
          field("Holiday Theme", annValue("holiday_theme", true)),
        ],
      },
      {
        title: "Main Subject",
        fields: [
          field("Actions", annValue("actions", true)),
          field("Pose", annValue("pose", true)),
          field("Emotion", annValue("emotion", true)),
        ],
      },
      {
        title: "Background Items",
        fields: [
          field("Items", annValue("items", true)),
          field("Held Item", annValue("held_item", true)),
          field("Berries (if present)", annValue("berries", true)),
          field("Pokeball Type (if present)", annValue("pokeball", true)),
          field("Evolution Items (if present)", annValue("evolution_items", true)),
        ],
      },
      {
        title: "Additional Characters",
        fields: [
          field("Background Pokémon", annValue("background_pokemon", true)),
          field("Background People Type", annValue("background_humans", true)),
          field("Background People Name", annValue("additional_characters", true)),
          field("Rival Faction", annValue("rival_group")),
          field("Additional Character Theme", annValue("additional_character_theme", true)),
        ],
      },
      {
        title: "Artistic Expression",
        fields: [
          field("Art Style", annValue("art_style", true)),
          field("Camera Angle", annValue("camera_angle")),
          field("Perspective", annValue("perspective")),
          field("Multi Card", annValue("multi_card", true)),
        ],
      },
      {
        title: "Video Games",
        fields: [
          field("Video Game", annValue("video_game", true)),
          field("Video Game Location", annValue("video_game_location", true)),
        ],
      },
      {
        title: "YouTube Videos",
        fields: [
          field("Shorts Appearance", ann.shorts_appearance || false),
          field("Region Appearance", ann.region_appearance || false),
          field("Thumbnail Used", ann.thumbnail_used || false),
          field("Video Title", annValue("video_title", true)),
          field("Video Type", annValue("video_type", true)),
          field("Video Region", annValue("video_region", true)),
          field("Top 10 Themes", annValue("top_10_themes", true)),
          field("WTPC Episode", annValue("wtpc_episode", true)),
          field("Video Location", annValue("video_location", true)),
        ],
      },
      {
        title: "Notes",
        fields: [
          field("Pocket Exclusive", ann.pocket_exclusive || false),
          field("Owned", ann.owned || false),
          field("Notes", annValue("notes")),
        ],
      },
    ];

    const nonEmptySections = sections.filter((s) => s.fields.some(Boolean));

    if (nonEmptySections.length === 0) {
      return (
        <p className="text-sm text-gray-400 italic">
          No annotations yet. Click Edit to add.
        </p>
      );
    }

    return (
      <div className="space-y-3">
        {nonEmptySections.map((s) => (
          <div key={s.title}>
            {sectionHeader(s.title)}
            <div className="mt-2 space-y-1">
              {s.fields.filter(Boolean)}
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    // Backdrop — clicking it closes the modal.
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full my-8 overflow-hidden">
        {/* Top bar: navigation arrows + close button */}
        <div className="flex items-center justify-between p-3 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={onPrev}
                disabled={!hasPrev}
                className="p-1 hover:bg-gray-100 rounded-full transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                title="Previous card"
              >
                <ChevronLeft className="w-6 h-6 text-gray-500" strokeWidth={2} aria-hidden />
              </button>
              <button
                onClick={onNext}
                disabled={!hasNext}
                className="p-1 hover:bg-gray-100 rounded-full transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                title="Next card"
              >
                <ChevronRight className="w-6 h-6 text-gray-500" strokeWidth={2} aria-hidden />
              </button>
            </div>
            {useSupabaseBackend() && card && !loading && (
              <button
                type="button"
                onClick={async () => {
                  const url = `${window.location.origin}/share/card/${encodeURIComponent(card.id)}`;
                  try {
                    await navigator.clipboard.writeText(url);
                    toastSuccess("Share link copied");
                  } catch {
                    toastError("Could not copy link");
                  }
                }}
                className="shrink-0 px-2.5 py-1 text-xs font-medium bg-slate-100 text-slate-800 rounded-lg hover:bg-slate-200 border border-slate-200/80 inline-flex items-center gap-1"
                title="Copy read-only link for this card"
              >
                <Share2 className="w-3.5 h-3.5" aria-hidden />
                Copy share link
              </button>
            )}
            {onSendToWorkbench && card && !loading && (
              <button
                type="button"
                onClick={() => onSendToWorkbench(card.id)}
                className="shrink-0 px-2.5 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-lg hover:bg-green-200 border border-green-200/80"
              >
                Send to Workbench
              </button>
            )}
            {onAddToBatchList && onRemoveFromBatchList && card && !loading && (
              inBatchList ? (
                <button
                  type="button"
                  onClick={() => onRemoveFromBatchList()}
                  className="shrink-0 px-2.5 py-1 text-xs font-medium bg-amber-50 text-amber-900 rounded-lg hover:bg-amber-100 border border-amber-200/80"
                >
                  Remove from batch list
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onAddToBatchList()}
                  className="shrink-0 px-2.5 py-1 text-xs font-medium bg-sky-50 text-sky-900 rounded-lg hover:bg-sky-100 border border-sky-200/80"
                >
                  Add to batch list
                </button>
              )
            )}
          </div>
          <button
            onClick={handleClose}
            className="p-1 hover:bg-gray-100 rounded-full transition-colors"
          >
            <X className="w-6 h-6 text-gray-500" strokeWidth={2} aria-hidden />
          </button>
        </div>

        {/* Loading state */}
        {loading && (
          <div className="p-12 text-center text-gray-400">
            Loading card details...
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="p-12 text-center text-green-500">{error}</div>
        )}

        {/* Card content */}
        {card && !loading && (
          <div className="px-6 pb-6">
            <div className="flex flex-col md:flex-row gap-6">
              {/* Left: large card image */}
              <div className="flex-shrink-0">
                {(() => {
                  const displayImage = ann.image_override || card.image_large;

                  // Image editing mode
                  if (editingImage) {
                    return (
                      <div className="w-full md:w-72 space-y-3">
                        <div className="space-y-2">
                          <FormFieldLabel>Image URL</FormFieldLabel>
                          <input
                            type="url"
                            value={newImageUrl}
                            onChange={(e) => setNewImageUrl(e.target.value)}
                            placeholder="https://..."
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm
                                     focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                            autoFocus
                          />
                        </div>

                        {/* Preview */}
                        {newImageUrl && (
                          <div className="space-y-1">
                            <FormFieldLabel>Preview</FormFieldLabel>
                            <img
                              src={newImageUrl}
                              alt="Preview"
                              className="w-full rounded-lg shadow-md bg-gray-100"
                              onError={(e) => {
                                e.target.style.display = "none";
                              }}
                              onLoad={(e) => {
                                e.target.style.display = "block";
                              }}
                            />
                          </div>
                        )}

                        {/* Action buttons */}
                        <div className="flex gap-2">
                          <button
                            onClick={async () => {
                              if (!newImageUrl.trim()) return;
                              setSavingImage(true);
                              const saveImg = async () => {
                                const updated = await patchAnnotations(cardId, {
                                  image_override: newImageUrl.trim(),
                                });
                                queryClient.setQueryData(cardDetailQueryKey, (prev) =>
                                  prev ? { ...prev, annotations: updated } : prev
                                );
                                setEditingImage(false);
                                setNewImageUrl("");
                              };
                              try {
                                if (useSupabaseBackend()) {
                                  await withSupabaseAnnotationSave(saveImg);
                                } else {
                                  await saveImg();
                                }
                              } catch (err) {
                                if (!useSupabaseBackend()) {
                                  console.error("Failed to save image:", err);
                                } else {
                                  void (async () => {
                                    try {
                                      const fresh = await fetchCard(cardId, source);
                                      queryClient.setQueryData(cardDetailQueryKey, fresh);
                                    } catch (e) {
                                      const m = String(e?.message ?? e ?? "").toLowerCase();
                                      if (/not found|pgrst116|could not find|0 rows/i.test(m)) {
                                        onClose?.();
                                      }
                                    }
                                  })();
                                }
                              } finally {
                                setSavingImage(false);
                              }
                            }}
                            disabled={!newImageUrl.trim() || savingImage}
                            className="flex-1 px-3 py-2 bg-green-600 text-white text-sm font-medium
                                     rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed
                                     transition-colors"
                          >
                            {savingImage ? "Saving..." : "Save"}
                          </button>
                          <button
                            onClick={() => {
                              setEditingImage(false);
                              setNewImageUrl("");
                            }}
                            className="px-3 py-2 bg-gray-100 text-gray-700 text-sm font-medium
                                     rounded-lg hover:bg-gray-200 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    );
                  }

                  // Display image or placeholder
                  return displayImage ? (
                    <div className="relative group">
                      <img
                        src={displayImage}
                        alt={card.name}
                        className="w-full md:w-72 rounded-lg shadow-md cursor-pointer"
                        onClick={() => setImageEnlarged(true)}
                        onError={(e) => {
                          if (card.image_fallback && e.target.src !== card.image_fallback) {
                            e.target.src = card.image_fallback;
                          }
                        }}
                      />
                      {/* Edit button overlay */}
                      <button
                        onClick={() => {
                          setNewImageUrl(ann.image_override || "");
                          setEditingImage(true);
                        }}
                        className="absolute top-2 right-2 p-2 bg-black/50 text-white rounded-full
                                 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
                        title="Change image"
                      >
                        <Pencil className="w-4 h-4" strokeWidth={2} aria-hidden />
                      </button>
                    </div>
                  ) : (
                    <div className="w-full md:w-72 aspect-[2.5/3.5] bg-gray-100 rounded-lg shadow-md
                                  flex flex-col items-center justify-center gap-3">
                      <ImageIcon className="w-16 h-16 text-gray-300" strokeWidth={1.5} aria-hidden />
                      <span className="text-gray-400 text-sm">No Image</span>
                      <button
                        onClick={() => setEditingImage(true)}
                        className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg
                                 hover:bg-green-700 transition-colors flex items-center gap-2"
                      >
                        <Plus className="w-4 h-4" strokeWidth={2} aria-hidden />
                        Add image
                      </button>
                    </div>
                  );
                })()}
              </div>

              {/* Right: card info */}
              <div className="flex-1 min-w-0 flex flex-col min-h-0">
                {/* Card name and basic info — always visible above tabs */}
                <h2 className="text-2xl font-bold">{card.name}</h2>
                <CardAttributionLine
                  createdById={card.created_by}
                  creatorDisplayName={card.creator_display_name}
                  annotationUpdatedById={ann.updated_by}
                  annotationUpdatedByName={annotationEditorDisplayName}
                  annotationUpdatedAt={ann.updated_at}
                />
                <div className="flex flex-wrap gap-2 mt-2">
                  <span className="px-2 py-0.5 bg-gray-100 rounded text-sm text-gray-600">
                    {card.supertype}
                  </span>
                  {subtypes.map((s) => (
                    <span
                      key={s}
                      className="px-2 py-0.5 bg-gray-100 rounded text-sm text-gray-600"
                    >
                      {s}
                    </span>
                  ))}
                  {types.map((t) => (
                    !isEditMode && onFilterClick ? (
                      <button
                        key={t}
                        onClick={() => onFilterClick("element", t)}
                        className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-sm font-medium cursor-pointer hover:bg-blue-200 transition-colors"
                      >
                        {t}
                      </button>
                    ) : (
                      <span
                        key={t}
                        className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-sm font-medium"
                      >
                        {t}
                      </span>
                    )
                  ))}
                  {(ann.set_name || card.set_name) && !isEditMode && onFilterClick && (
                    <button
                      onClick={() => onFilterClick("set_id", card.set_id)}
                      className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-sm hover:bg-green-200 transition-colors"
                    >
                      {ann.set_name || card.set_name}
                    </button>
                  )}
                  {(ann.artist || card.artist) && !isEditMode && onFilterClick && (
                    <button
                      onClick={() => onFilterClick("artist", ann.artist || card.artist)}
                      className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-sm hover:bg-amber-200 transition-colors"
                    >
                      {ann.artist || card.artist}
                    </button>
                  )}
                </div>

                {/* Tab bar */}
                <div className="flex items-center mt-4 border-b border-gray-200">
                  <button
                    onClick={() => setActiveTab("info")}
                    className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                      activeTab === "info"
                        ? "border-green-600 text-green-700"
                        : "border-transparent text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    Attributes
                  </button>
                  <button
                    onClick={() => setActiveTab("attributes")}
                    className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                      activeTab === "attributes"
                        ? "border-green-600 text-green-700"
                        : "border-transparent text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    More Info
                  </button>
                  <button
                    onClick={() => setActiveTab("market")}
                    className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                      activeTab === "market"
                        ? "border-green-600 text-green-700"
                        : "border-transparent text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    Prices
                  </button>
                  <div className="ml-auto flex items-center gap-2 pb-2">
                    {isEditMode && (
                      <>
                        {useSupabaseBackend() ? (
                          <span className="text-xs max-w-[min(100%,18rem)] text-right leading-snug break-words">
                            {annSaveUi.phase === "saving" && (
                              <span className="text-amber-700 font-medium">Saving…</span>
                            )}
                            {annSaveUi.phase === "saved" && annSaveUi.savedAt && (
                              <span className="text-green-700 font-medium">
                                Saved {annSaveUi.savedAt.toLocaleTimeString()}
                              </span>
                            )}
                            {annSaveUi.phase === "error" && annSaveUi.errorDetail && (
                              <span className="text-red-700 font-medium" title={annSaveUi.errorDetail}>
                                Not saved
                              </span>
                            )}
                            {annSaveUi.phase === "idle" && (
                              <span className="text-gray-500">Changes save as you edit.</span>
                            )}
                          </span>
                        ) : (
                          <>
                            {(saveStatus === "saved" || saveStatus === "queued") && saveMessage && (
                              <span
                                className={`text-xs font-medium ${saveStatus === "saved" ? "text-green-600" : "text-gray-600"}`}
                              >
                                {saveMessage}
                              </span>
                            )}
                            <button
                              onClick={handleSaveChanges}
                              disabled={saveStatus === "saving"}
                              className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 font-medium disabled:opacity-50"
                            >
                              {saveStatus === "saving" ? "Syncing…" : "Sync to GitHub"}
                            </button>
                          </>
                        )}
                      </>
                    )}
                    <button
                      onClick={() => {
                        if (!isEditMode) {
                          setIsEditMode(true);
                          setActiveTab("attributes");
                        } else {
                          setIsEditMode(false);
                          setActiveTab("info");
                        }
                      }}
                      className="text-xs px-2 py-1 rounded bg-green-600 text-white hover:bg-green-700 font-medium"
                    >
                      {isEditMode ? "Done" : "Edit"}
                    </button>
                    {!isEditMode && card?.is_custom === true && (
                      <button
                        onClick={() => setShowDeleteConfirm(true)}
                        className="text-xs px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200 font-medium"
                      >
                        Delete Card
                      </button>
                    )}
                  </div>
                </div>

                {/* Supabase: inline save failed — toast also shown; dismiss clears sticky error text */}
                {useSupabaseBackend() && isEditMode && annSaveUi.phase === "error" && annSaveUi.errorDetail && (
                  <div className="mt-2 flex items-start gap-2 text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                    <span className="flex-1 min-w-0">{annSaveUi.errorDetail}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setAnnSaveUi({ phase: "idle", savedAt: null, errorDetail: null })
                      }
                      className="shrink-0 text-red-600 hover:text-red-800 font-medium text-xs"
                    >
                      Dismiss
                    </button>
                  </div>
                )}

                {/* Sync error (GitHub path only — Supabase saves per field to Postgres) */}
                {!useSupabaseBackend() && saveStatus === "error" && saveMessage && (
                  <div className="mt-2 flex items-center gap-2 text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                    <span className="flex-1">
                      Edits saved locally —{" "}
                      {syncRetryCount > 0
                        ? "still can't sync to GitHub. Check your token in Settings."
                        : saveMessage
                            .replace("Couldn't sync — ", "")
                            .replace("Couldn't sync to GitHub.", "couldn't sync to GitHub.")}
                    </span>
                    {syncRetryCount === 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setSyncRetryCount((n) => n + 1);
                          runSyncNow();
                        }}
                        className="shrink-0 text-sm font-medium px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700"
                      >
                        Retry
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setSaveStatus(null);
                        setSaveMessage("");
                        setSyncRetryCount(0);
                      }}
                      className="shrink-0 text-red-600 hover:text-red-800 font-medium"
                    >
                      Dismiss
                    </button>
                  </div>
                )}

                {/* Info tab panel */}
                {activeTab === "info" && (
                  <div className="mt-4 space-y-4 overflow-y-auto flex-1 pr-1">
                    {/* Set and card number */}
                    <div className="text-sm text-gray-500">
                      {ann.set_name || card.set_name} ({card.set_series}) · #{card.number}
                      {card.pokedex_numbers?.length > 0 && (
                        <> · Pokedex: {card.pokedex_numbers.join(", ")}</>
                      )}
                      {card.rarity && ` · ${card.rarity}`}
                      {(ann.artist || card.artist) && ` · Artist: ${ann.artist || card.artist}`}
                    </div>

                    {/* Pocket-specific fields */}
                    {card.stage && (
                      <p className="text-sm text-gray-600">
                        Stage: <strong>{card.stage}</strong>
                      </p>
                    )}

                    {card.retreat_cost != null && card.retreat_cost > 0 && (
                      <p className="text-sm text-gray-600">
                        Retreat Cost: <strong>{card.retreat_cost}</strong>
                      </p>
                    )}

                    {/* Annotation attributes */}
                    <div className="pt-2 border-t border-gray-100">
                      {renderAnnotationView()}
                    </div>
                  </div>
                )}

                {/* Attributes tab panel */}
                {activeTab === "attributes" && (
                  <div className="mt-4 flex-1 overflow-y-auto pr-1">
                    {isEditMode ? (
                      <div className="space-y-4">
                        {useSupabaseBackend() ? (
                          <div className="text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded px-3 py-2">
                            Edits apply as you change each field. Save status appears next to{" "}
                            <strong className="font-semibold">Done</strong> (and you get a toast if a save fails).
                          </div>
                        ) : getToken() ? (
                          <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
                            GitHub PAT configured — annotation changes will sync across devices.
                          </div>
                        ) : (
                          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                            No GitHub PAT configured — annotation changes will only save locally to this browser.
                            Add a PAT in Settings to sync across devices.
                          </div>
                        )}
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-medium text-gray-600">Pinned fields</span>
                          <button
                            type="button"
                            onClick={() => setPinEditorOpen(true)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-tm-leaf hover:underline"
                          >
                            <Pencil className="w-3.5 h-3.5" strokeWidth={2} aria-hidden />
                            Edit pins
                          </button>
                        </div>
                        {normalizedCardDetailPins.length > 0 && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 rounded-xl border border-tm-leaf/25 bg-tm-cream/60 p-3">
                            {normalizedCardDetailPins.map((pk) => (
                              <CardDetailFieldControl
                                key={`pin-${pk}`}
                                fieldKey={pk}
                                ann={ann}
                                card={card}
                                annValue={annValue}
                                saveAnnotation={saveAnnotation}
                                formOpts={opts}
                                inputClass={inputClass}
                                idSuffix="-pin"
                                types={types}
                                onFilterClick={onFilterClick}
                              />
                            ))}
                          </div>
                        )}
                        <CollapsibleSection title="Annotations" defaultOpen={true}>
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">

                            {/* ── Mon Classification ── */}
                            <div className="col-span-2 md:col-span-3 flex items-center gap-2 pt-5 mt-3">
                              <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Mon Classification</span>
                              <div className="flex-1 h-px bg-gray-200" />
                            </div>
                            <div className="col-span-2 md:col-span-3">
                              <FormFieldLabel>Set Name</FormFieldLabel>
                              <ComboBox
                                value={annValue("set_name") || card.set_name || ""}
                                onChange={(v) => saveAnnotation("set_name", v)}
                                options={optArr(opts.setName)}
                                placeholder="Set name"
                                className={inputClass + " w-full"}
                              />
                            </div>
                            <div>
                              <FormFieldLabel>Rarity</FormFieldLabel>
                              <ComboBox value={annValue("rarity") || card.rarity || ""} onChange={(v) => saveAnnotation("rarity", v)} options={optArr(opts.rarity)} placeholder="Promo" className={inputClass + " w-full"} />
                            </div>
                            <div>
                              <FormFieldLabel>Artist</FormFieldLabel>
                              <ComboBox value={annValue("artist") || card.artist || ""} onChange={(v) => saveAnnotation("artist", v)} options={optArr(opts.artist)} placeholder="Ken Sugimori" className={inputClass + " w-full"} />
                            </div>
                            <div>
                              <FormFieldLabel>Type</FormFieldLabel>
                              <MultiComboBox value={annValue("types", true) || types.join(", ")} onChange={(v) => saveAnnotation("types", v)} options={TCG_TYPE_OPTIONS} placeholder="Fire, Water, Lightning, etc." />
                            </div>
                            <div>
                              <FormFieldLabel>Unique ID</FormFieldLabel>
                              <input
                                type="text"
                                value={annValue("unique_id")}
                                onChange={(e) => saveAnnotation("unique_id", e.target.value)}
                                placeholder="e.g. custom-xy001"
                                className={inputClass}
                              />
                            </div>
                            <div>
                              <FormFieldLabel>Card Subcategory</FormFieldLabel>
                              <MultiComboBox value={annValue("card_subcategory", true)} onChange={(v) => saveAnnotation("card_subcategory", v)} options={optArr(opts.cardSubcategory).length ? optArr(opts.cardSubcategory) : CARD_SUBCATEGORY_OPTIONS} placeholder="Full Art, Illustration Rare, etc." />
                            </div>
                            <div>
                              <FormFieldLabel>Evolution Line</FormFieldLabel>
                              <ComboBox value={formatEvolutionLineLabel(annValue("evolution_line"))} onChange={(v) => saveAnnotation("evolution_line", v)} options={normalizeEvolutionLineOptions(optArr(opts.evolutionLine))} placeholder="Pichu → Pikachu → Raichu" className={inputClass + " w-full"} />
                            </div>
                            <div>
                              <FormFieldLabel>Card Border Color</FormFieldLabel>
                              <ComboBox value={annValue("card_border")} onChange={(v) => saveAnnotation("card_border", v)} options={optArr(opts.cardBorder).length ? optArr(opts.cardBorder) : CARD_BORDER_OPTIONS} placeholder="Yellow, Silver, Blue, etc." className={inputClass + " w-full"} />
                            </div>
                            <div>
                              <FormFieldLabel>Stamp</FormFieldLabel>
                              <ComboBox value={annValue("stamp")} onChange={(v) => saveAnnotation("stamp", v)}
                                options={optArr(opts.stamp).length ? optArr(opts.stamp) : STAMP_OPTIONS} placeholder="Pokemon Center, Game Stop, etc."
                                className={inputClass + " w-full"} />
                            </div>

                            {/* ── Other Card Classification ── */}
                            <div className="col-span-2 md:col-span-3 flex items-center gap-2 pt-5 mt-3">
                              <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Other Card Classification</span>
                              <div className="flex-1 h-px bg-gray-200" />
                            </div>
                            <div>
                              <FormFieldLabel>Trainer Card Type</FormFieldLabel>
                              <ComboBox value={annValue("trainer_card_type")} onChange={(v) => saveAnnotation("trainer_card_type", v)} options={optArr(opts.trainerCardType).length ? optArr(opts.trainerCardType) : TRAINER_CARD_TYPE_OPTIONS} placeholder="Supporter, Item, Stadium, etc." className={inputClass + " w-full"} />
                            </div>
                            <div>
                              <FormFieldLabel>Trainer Card Subgroup</FormFieldLabel>
                              <MultiComboBox value={annValue("trainer_card_subgroup", true)} onChange={(v) => saveAnnotation("trainer_card_subgroup", v)} options={optArr(opts.trainerCardSubgroup).length ? optArr(opts.trainerCardSubgroup) : TRAINER_CARD_SUBGROUP_OPTIONS} placeholder="Nameless Supporter, Villain Team Items, etc." />
                            </div>
                            <div>
                              <FormFieldLabel>Energy Card Type</FormFieldLabel>
                              <ComboBox value={annValue("energy_type")} onChange={(v) => saveAnnotation("energy_type", v)} options={optArr(opts.energyType).length ? optArr(opts.energyType) : ENERGY_TYPE_OPTIONS} placeholder="Basic, Special" className={inputClass + " w-full"} />
                            </div>

                            {/* ── Scene & Setting ── */}
                            <div className="col-span-2 md:col-span-3 flex items-center gap-2 pt-5 mt-3">
                              <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Scene & Setting</span>
                              <div className="flex-1 h-px bg-gray-200" />
                            </div>
                            <div>
                              <FormFieldLabel>Featured Region</FormFieldLabel>
                              <ComboBox value={annValue("pkmn_region")} onChange={(v) => saveAnnotation("pkmn_region", v)} options={optArr(opts.pkmnRegion)} placeholder="Kanto, Johto, Aquapolis, etc." className={inputClass + " w-full"} />
                            </div>
                            <div>
                              <FormFieldLabel>Card Location</FormFieldLabel>
                              <ComboBox value={annValue("card_locations")} onChange={(v) => saveAnnotation("card_locations", v)} options={optArr(opts.cardLocations)} placeholder="Pallet Town, Route 110, etc." className={inputClass + " w-full"} />
                            </div>
                            <div>
                              <FormFieldLabel>Environment</FormFieldLabel>
                              <MultiComboBox value={annValue("environment", true)} onChange={(v) => saveAnnotation("environment", v)} options={optArr(opts.environment)} placeholder="Forest, Beach, Stadium, etc." />
                            </div>
                            <div>
                              <FormFieldLabel>Weather</FormFieldLabel>
                              <ComboBox value={annValue("weather")} onChange={(v) => saveAnnotation("weather", v)} options={optArr(opts.weather)} placeholder="Sunny, Lightning, Clouds, etc." className={inputClass + " w-full"} />
                            </div>
                            <div>
                              <FormFieldLabel>Background Details</FormFieldLabel>
                              <MultiComboBox value={annValue("background_details", true)} onChange={(v) => saveAnnotation("background_details", v)} options={optArr(opts.backgroundDetails)} placeholder="Island, Stump, Seafloor, Bridge, etc." />
                            </div>
                            <div>
                              <FormFieldLabel>Holiday Theme</FormFieldLabel>
                              <MultiComboBox value={annValue("holiday_theme", true)} onChange={(v) => saveAnnotation("holiday_theme", v)} options={optArr(opts.holidayTheme).length ? optArr(opts.holidayTheme) : HOLIDAY_THEME_OPTIONS} placeholder="Halloween, Christmas, etc." />
                            </div>

                            {/* ── Main Subject ── */}
                            <div className="col-span-2 md:col-span-3 flex items-center gap-2 pt-5 mt-3">
                              <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Main Subject</span>
                              <div className="flex-1 h-px bg-gray-200" />
                            </div>
                            <div>
                              <FormFieldLabel>Actions</FormFieldLabel>
                              <MultiComboBox value={annValue("actions", true)} onChange={(v) => saveAnnotation("actions", v)} options={optArr(opts.actions)} placeholder="Dancing, Firefighters, On A Boat" />
                            </div>
                            <div>
                              <FormFieldLabel>Pose</FormFieldLabel>
                              <MultiComboBox value={annValue("pose", true)} onChange={(v) => saveAnnotation("pose", v)} options={optArr(opts.pose)} placeholder="Flexing, Come At Me Bro, etc." />
                            </div>
                            <div>
                              <FormFieldLabel>Emotion</FormFieldLabel>
                              <MultiComboBox value={annValue("emotion", true)} onChange={(v) => saveAnnotation("emotion", v)} options={optArr(opts.emotion)} placeholder="Crying, Scared, Angry, etc." />
                            </div>

                            {/* ── Background Items ── */}
                            <div className="col-span-2 md:col-span-3 flex items-center gap-2 pt-5 mt-3">
                              <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Background Items</span>
                              <div className="flex-1 h-px bg-gray-200" />
                            </div>
                            <div>
                              <FormFieldLabel>Items</FormFieldLabel>
                              <MultiComboBox value={annValue("items", true)} onChange={(v) => saveAnnotation("items", v)} options={optArr(opts.items)} placeholder="Clefairy Doll, Apple, Fossil, etc." />
                            </div>
                            <div>
                              <FormFieldLabel>Held Item</FormFieldLabel>
                              <MultiComboBox value={annValue("held_item", true)} onChange={(v) => saveAnnotation("held_item", v)} options={optArr(opts.heldItem).length ? optArr(opts.heldItem) : HELD_ITEM_OPTIONS} placeholder="Food, Flower, Pokeball, etc." />
                            </div>
                            <div>
                              <FormFieldLabel>Berries (if present)</FormFieldLabel>
                              <MultiComboBox value={annValue("berries", true)} onChange={(v) => saveAnnotation("berries", v)} options={optArr(opts.berries).length ? optArr(opts.berries) : BERRIES_OPTIONS} placeholder="Oran Berry, Razz Berry, etc." />
                            </div>
                            <div>
                              <FormFieldLabel>Pokeball Type (if present)</FormFieldLabel>
                              <MultiComboBox value={annValue("pokeball", true)} onChange={(v) => saveAnnotation("pokeball", v)} options={optArr(opts.pokeball).length ? optArr(opts.pokeball) : POKEBALL_OPTIONS} placeholder="Great Ball, Timer Ball, etc." />
                            </div>
                            <div>
                              <FormFieldLabel>Evolution Items (if present)</FormFieldLabel>
                              <MultiComboBox value={annValue("evolution_items", true)} onChange={(v) => saveAnnotation("evolution_items", v)} options={optArr(opts.evolutionItems).length ? optArr(opts.evolutionItems) : EVOLUTION_ITEMS_OPTIONS} placeholder="Leaf Stone, Upgrade, etc." />
                            </div>

                            {/* ── Additional Characters ── */}
                            <div className="col-span-2 md:col-span-3 flex items-center gap-2 pt-5 mt-3">
                              <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Additional Characters</span>
                              <div className="flex-1 h-px bg-gray-200" />
                            </div>
                            <div>
                              <FormFieldLabel>Background Pokemon</FormFieldLabel>
                              <MultiComboBox value={annValue("background_pokemon", true)} onChange={(v) => saveAnnotation("background_pokemon", v)} options={optArr(opts.backgroundPokemon)} placeholder="Squirtle, Pikachu, etc." onTagClick={onFilterClick ? (tag) => onFilterClick("background_pokemon", tag) : undefined} />
                              <p className="mt-1 text-[11px] text-gray-500">Tip: click a tag to filter Explore by that value.</p>
                            </div>
                            <div>
                              <FormFieldLabel>Background People Type</FormFieldLabel>
                              <MultiComboBox value={annValue("background_humans", true)} onChange={(v) => saveAnnotation("background_humans", v)} options={optArr(opts.backgroundHumans)} placeholder="Gym Leader, Trainer, Civilian" />
                            </div>
                            <div>
                              <FormFieldLabel>Background People Name</FormFieldLabel>
                              <MultiComboBox value={annValue("additional_characters", true)} onChange={(v) => saveAnnotation("additional_characters", v)} options={optArr(opts.additionalCharacters)} placeholder="Brock, Professor Oak, Delinquent" />
                            </div>
                            <div>
                              <FormFieldLabel>Rival Faction</FormFieldLabel>
                              <ComboBox value={annValue("rival_group")} onChange={(v) => saveAnnotation("rival_group", v)} options={optArr(opts.rivalGroup).length ? optArr(opts.rivalGroup) : RIVAL_GROUP_OPTIONS} placeholder="Team Rocket, Team Aqua, etc." className={inputClass + " w-full"} />
                            </div>
                            <div>
                              <FormFieldLabel>Additional Character Theme</FormFieldLabel>
                              <MultiComboBox value={annValue("additional_character_theme", true)} onChange={(v) => saveAnnotation("additional_character_theme", v)} options={optArr(opts.additionalCharacterTheme).length ? optArr(opts.additionalCharacterTheme) : ADDITIONAL_CHARACTER_THEME_OPTIONS} placeholder="Family First, Squad Gang, etc." />
                            </div>

                            {/* ── Artistic Expression ── */}
                            <div className="col-span-2 md:col-span-3 flex items-center gap-2 pt-5 mt-3">
                              <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Artistic Expression</span>
                              <div className="flex-1 h-px bg-gray-200" />
                            </div>
                            <div>
                              <FormFieldLabel>Art Style</FormFieldLabel>
                              <MultiComboBox value={annValue("art_style", true)} onChange={(v) => saveAnnotation("art_style", v)} options={optArr(opts.artStyle)} placeholder="2D, Clay, Trippy Art, etc." />
                            </div>
                            <div>
                              <FormFieldLabel>Camera Angle</FormFieldLabel>
                              <ComboBox value={annValue("camera_angle")} onChange={(v) => saveAnnotation("camera_angle", v)} options={optArr(opts.cameraAngle)} placeholder="Aerial, Upside Down, etc." className={inputClass + " w-full"} />
                            </div>
                            <div>
                              <FormFieldLabel>Perspective</FormFieldLabel>
                              <ComboBox value={annValue("perspective")} onChange={(v) => saveAnnotation("perspective", v)} options={optArr(opts.perspective)} placeholder="POV, Tiny, Rotate 90 Degrees" className={inputClass + " w-full"} />
                            </div>
                            <div>
                              <FormFieldLabel>Multi Card</FormFieldLabel>
                              <MultiComboBox value={annValue("multi_card", true)} onChange={(v) => saveAnnotation("multi_card", v)} options={optArr(opts.multiCard).length ? optArr(opts.multiCard) : MULTI_CARD_OPTIONS} placeholder="Storytelling, Different Angles, etc." />
                            </div>

                          </div>
                        </CollapsibleSection>

                        <CollapsibleSection title="Video" defaultOpen={true}>
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">

                            {/* ── Video Games ── */}
                            <div className="col-span-2 md:col-span-3 flex items-center gap-2 pt-5 mt-3">
                              <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Video Games</span>
                              <div className="flex-1 h-px bg-gray-200" />
                            </div>
                            <div>
                              <FormFieldLabel>Video Game</FormFieldLabel>
                              <MultiComboBox value={annValue("video_game", true)} onChange={(v) => saveAnnotation("video_game", v)} options={VIDEO_GAME_OPTIONS} placeholder="X/Y" />
                            </div>
                            <div>
                              <FormFieldLabel>Video Game Location</FormFieldLabel>
                              <MultiComboBox value={annValue("video_game_location", true)} onChange={(v) => saveAnnotation("video_game_location", v)} options={optArr(opts.videoGameLocation).length ? optArr(opts.videoGameLocation) : VIDEO_LOCATION_OPTIONS} placeholder="Pallet Town, Route 1" />
                            </div>

                            {/* ── YouTube Videos ── */}
                            <div className="col-span-2 md:col-span-3 flex items-center gap-2 pt-5 mt-3">
                              <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">YouTube Videos</span>
                              <div className="flex-1 h-px bg-gray-200" />
                            </div>
                            <div className="flex items-center gap-2 pt-1 pb-3">
                              <input type="checkbox" id="cardDetail-shortsAppearance" checked={!!ann.shorts_appearance} onChange={(e) => saveAnnotation("shorts_appearance", e.target.checked)} className="rounded" />
                              <label htmlFor="cardDetail-shortsAppearance" className="text-sm text-gray-700">Shorts Appearance</label>
                            </div>
                            <div className="flex items-center gap-2 pt-1 pb-3">
                              <input type="checkbox" id="cardDetail-regionAppearance" checked={!!ann.region_appearance} onChange={(e) => saveAnnotation("region_appearance", e.target.checked)} className="rounded" />
                              <label htmlFor="cardDetail-regionAppearance" className="text-sm text-gray-700">Region Appearance</label>
                            </div>
                            <div className="flex items-center gap-2 pt-1 pb-3">
                              <input type="checkbox" id="cardDetail-thumbnailUsed" checked={!!ann.thumbnail_used} onChange={(e) => saveAnnotation("thumbnail_used", e.target.checked)} className="rounded" />
                              <label htmlFor="cardDetail-thumbnailUsed" className="text-sm text-gray-700">Thumbnail Used</label>
                            </div>
                            <div className="col-span-2 md:col-span-3">
                              <FormFieldLabel>Video Title</FormFieldLabel>
                              <MultiComboBox value={annValue("video_title", true)} onChange={(v) => saveAnnotation("video_title", v)} options={optArr(opts.videoTitle)} placeholder="Video title" />
                            </div>
                            <div className="col-span-2 md:col-span-3">
                              <FormFieldLabel>Video Type</FormFieldLabel>
                              <MultiComboBox value={annValue("video_type", true)} onChange={(v) => saveAnnotation("video_type", v)}
                                options={optArr(opts.videoType).length ? optArr(opts.videoType) : VIDEO_TYPE_OPTIONS} placeholder="Top 10, Every Card in a Region" />
                            </div>
                            <div>
                              <FormFieldLabel>Video Region</FormFieldLabel>
                              <MultiComboBox value={annValue("video_region", true)} onChange={(v) => saveAnnotation("video_region", v)}
                                options={optArr(opts.videoRegion).length ? optArr(opts.videoRegion) : VIDEO_REGION_OPTIONS} placeholder="Kanto, Johto" />
                            </div>
                            <div>
                              <FormFieldLabel>Top 10 Themes</FormFieldLabel>
                              <MultiComboBox value={annValue("top_10_themes", true)} onChange={(v) => saveAnnotation("top_10_themes", v)}
                                options={optArr(opts.top10Themes).length ? optArr(opts.top10Themes) : TOP_10_THEMES_OPTIONS} placeholder="Theme" />
                            </div>
                            <div>
                              <FormFieldLabel>WTPC Episode Number</FormFieldLabel>
                              <MultiComboBox value={annValue("wtpc_episode", true)} onChange={(v) => saveAnnotation("wtpc_episode", v)}
                                options={WTPC_EPISODE_OPTIONS} placeholder="Episode 1" />
                            </div>
                            <div>
                              <FormFieldLabel>Video Location</FormFieldLabel>
                              <MultiComboBox value={annValue("video_location", true)} onChange={(v) => saveAnnotation("video_location", v)}
                                options={optArr(opts.videoLocation).length ? optArr(opts.videoLocation) : VIDEO_LOCATION_OPTIONS} placeholder="Pallet Town, Lumiose City" />
                            </div>
                          </div>
                        </CollapsibleSection>

                        <CollapsibleSection title="Notes" defaultOpen={false}>
                          <div className="space-y-3">
                            <div className="flex items-center gap-2">
                              <input type="checkbox" id="cardDetail-pocketExclusive"
                                checked={!!ann.pocket_exclusive}
                                onChange={(e) => saveAnnotation("pocket_exclusive", e.target.checked)}
                                className="rounded" />
                              <label htmlFor="cardDetail-pocketExclusive" className="text-sm text-gray-700">Pocket Exclusive</label>
                            </div>
                            <div className="flex items-center gap-2">
                              <input type="checkbox" id="cardDetail-owned" checked={!!ann.owned} onChange={(e) => saveAnnotation("owned", e.target.checked)} className="rounded" />
                              <label htmlFor="cardDetail-owned" className="text-sm text-gray-700">Owned</label>
                            </div>
                            <div>
                              <FormFieldLabel>Notes</FormFieldLabel>
                              <textarea value={annValue("notes")} onChange={(e) => saveAnnotation("notes", e.target.value)} rows={3} placeholder="Any additional notes..." className={inputClass + " w-full"} />
                            </div>
                          </div>
                        </CollapsibleSection>

                        {card?.is_custom === true && (
                          <div className="pt-2">
                            <button
                              onClick={() => setShowDeleteConfirm(true)}
                              className="text-sm px-3 py-1.5 rounded bg-red-100 text-red-700 hover:bg-red-200 font-medium"
                            >
                              Delete Card
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {ann.unique_id && (
                          <p className="text-sm text-gray-600">Unique ID: <strong>{ann.unique_id}</strong></p>
                        )}
                        {card.evolves_from && (
                          <p className="text-sm text-gray-600">
                            Evolves from: <strong>{fixDisplayText(String(card.evolves_from))}</strong>
                          </p>
                        )}
                        {(ann.evolution_line && (Array.isArray(ann.evolution_line) ? ann.evolution_line.length : ann.evolution_line)) && (
                          <p className="text-sm text-gray-600">
                            Evolution Line:{" "}
                            <strong>
                              {formatEvolutionLineLabel(
                                Array.isArray(ann.evolution_line)
                                  ? JSON.stringify(ann.evolution_line)
                                  : String(ann.evolution_line)
                              )}
                            </strong>
                          </p>
                        )}
                        {card.genus && (
                          <p className="text-sm text-gray-600 italic">{fixDisplayText(card.genus)}</p>
                        )}
                        {rules.length > 0 && (
                          <div>
                            <h3 className="font-semibold text-sm text-gray-700 mb-1">Rules</h3>
                            {rules.map((rule, i) => (
                              <p key={i} className="text-sm text-gray-600 mt-1">
                                {String(rule)}
                              </p>
                            ))}
                          </div>
                        )}
                        {abilities.length > 0 && (
                          <div>
                            <h3 className="font-semibold text-sm text-gray-700 mb-1">Abilities</h3>
                            {abilities.map((ab, i) => (
                              <div key={i} className="mt-2">
                                <p className="text-sm font-medium text-purple-700">
                                  {String(ab.name ?? "")}
                                  <span className="text-gray-400 ml-1">({ab.type})</span>
                                </p>
                                <p className="text-sm text-gray-600">{String(ab.text ?? "")}</p>
                              </div>
                            ))}
                          </div>
                        )}
                        {(raw?.flavorText || raw?.flavor_text) && (
                          <p className="text-sm text-gray-600 italic border-l-2 border-gray-300 pl-3">
                            {String(raw.flavorText ?? raw.flavor_text)}
                          </p>
                        )}
                        {attacks.length > 0 && (
                          <div>
                            <h3 className="font-semibold text-sm text-gray-700 mb-1">Attacks</h3>
                            {attacks.map((atk, i) => (
                              <div key={i} className="mt-2 p-2 bg-gray-50 rounded">
                                <div className="flex items-center justify-between">
                                  <span className="font-medium text-sm">{String(atk.name ?? "")}</span>
                                  {atk.damage && (
                                    <span className="text-green-600 font-bold text-sm">{atk.damage}</span>
                                  )}
                                </div>
                                {atk.cost && (
                                  <p className="text-xs text-gray-400 mt-0.5">Cost: {atk.cost.join(", ")}</p>
                                )}
                                {atk.text && (
                                  <p className="text-sm text-gray-600 mt-1">{String(atk.text)}</p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        {(weaknesses.length > 0 || resistances.length > 0 || retreatCost.length > 0) && (
                          <div className="flex flex-wrap gap-4 text-sm">
                            {weaknesses.length > 0 && (
                              <div>
                                <span className="font-semibold text-gray-700">Weakness: </span>
                                {weaknesses.map((w, i) => (
                                  <span key={i} className="text-gray-600">
                                    {w.type} {w.value}{i < weaknesses.length - 1 ? ", " : ""}
                                  </span>
                                ))}
                              </div>
                            )}
                            {resistances.length > 0 && (
                              <div>
                                <span className="font-semibold text-gray-700">Resistance: </span>
                                {resistances.map((r, i) => (
                                  <span key={i} className="text-gray-600">
                                    {r.type} {r.value}{i < resistances.length - 1 ? ", " : ""}
                                  </span>
                                ))}
                              </div>
                            )}
                            {retreatCost.length > 0 && (
                              <div>
                                <span className="font-semibold text-gray-700">Retreat: </span>
                                <span className="text-gray-600">{retreatCost.length}</span>
                              </div>
                            )}
                          </div>
                        )}
                        {!ann.unique_id && !card.evolves_from && !(ann.evolution_line && (Array.isArray(ann.evolution_line) ? ann.evolution_line.length : ann.evolution_line)) && !card.genus && !rules.length && !abilities.length && !raw?.flavorText && !raw?.flavor_text && !attacks.length && !weaknesses.length && !resistances.length && !retreatCost.length && (
                          <p className="text-sm text-gray-400 text-center py-8">No additional information available.</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Market Information tab panel */}
                {activeTab === "market" && (
                  <div className="mt-4 flex-1 overflow-y-auto pr-1">
                    {card.prices?.tcgplayer?.prices ? (
                      <div className="space-y-3">
                        <h3 className="font-semibold text-sm text-gray-700 mb-2">
                          Market Prices (USD)
                        </h3>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          {Object.entries(card.prices.tcgplayer.prices).map(
                            ([variant, p]) => (
                              <div key={variant} className="bg-gray-50 rounded p-2">
                                <span className="font-medium capitalize text-gray-700">
                                  {variant.replace(/([A-Z])/g, " $1").trim()}
                                </span>
                                <div className="text-green-700 font-bold">
                                  ${p.market?.toFixed(2) || "—"}
                                </div>
                                <div className="text-xs text-gray-500">
                                  Low: ${p.low?.toFixed(2) || "—"} · High: ${p.high?.toFixed(2) || "—"}
                                </div>
                              </div>
                            )
                          )}
                        </div>
                        {card.prices.tcgplayer.updatedAt && (
                          <p className="text-xs text-gray-400 mt-2">
                            Prices from TCGPlayer · Updated {card.prices.tcgplayer.updatedAt}
                          </p>
                        )}
                        {card.prices.tcgplayer.url && (
                          <a
                            href={card.prices.tcgplayer.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-600 hover:underline mt-1 inline-block"
                          >
                            View on TCGPlayer
                          </a>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-400 text-center py-8">No market data available.</p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Delete confirmation dialog */}
            {showDeleteConfirm && (
              <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50">
                <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4">
                  <h2 className="text-lg font-semibold text-gray-900 mb-3">Delete Card?</h2>
                  <p className="text-sm text-gray-700 mb-2">
                    <span className="font-semibold">{card.name}</span> will be permanently deleted
                    {useSupabaseBackend()
                      ? " from the database."
                      : getToken()
                        ? " from this browser and from GitHub."
                        : " from this browser only. Add a GitHub PAT in Settings to also remove from GitHub."}
                  </p>
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
                      onClick={handleDeleteCard}
                      disabled={deleteInProgress}
                      className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {deleteInProgress ? "Deleting…" : "Yes, Delete"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <CardDetailPinEditor
              open={pinEditorOpen}
              onOpenChange={setPinEditorOpen}
              initialPins={normalizedCardDetailPins}
              onSave={(pins) => savePinsMutation.mutate(pins)}
              isSaving={savePinsMutation.isPending}
            />
          </div>
        )}
      </div>

      {/* Enlarged image overlay */}
      {imageEnlarged && card && (
        <div
          className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center cursor-pointer"
          onClick={() => setImageEnlarged(false)}
        >
          <img
            src={parseAnnotations(card).image_override || card.image_large}
            alt={card.name}
            className="max-h-[90vh] max-w-[90vw] object-contain"
            onClick={(e) => e.stopPropagation()}
            onError={(e) => {
              if (card.image_fallback && e.target.src !== card.image_fallback) {
                e.target.src = card.image_fallback;
              }
            }}
          />
        </div>
      )}
    </div>
  );
}
