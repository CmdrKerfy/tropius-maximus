/**
 * Workbench — Phase 5: queue-backed annotation editing (Supabase).
 */

import { useMemo, useState, useEffect, useCallback, useRef, useTransition } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ClipboardList,
  Columns2,
  Image as ImageIcon,
  Inbox,
  Loader2,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchWorkbenchQueues,
  fetchCardNamesByIds,
  fetchCardThumbnailsByIds,
  fetchCard,
  fetchAttributes,
  fetchFormOptions,
  FORM_OPTIONS_QUERY_KEY,
  updateWorkbenchQueue,
  createWorkbenchQueue,
  deleteWorkbenchQueue,
  fetchProfile,
  fetchUserPreferences,
} from "../db";
import AnnotationEditor from "../components/AnnotationEditor";
import CardAttributionLine from "../components/CardAttributionLine.jsx";
import AuthUserMenu from "../components/AuthUserMenu.jsx";
import WorkflowModeHelp from "../components/WorkflowModeHelp.jsx";
import Button from "../components/ui/Button.jsx";
import { useExperimentalAppNav } from "../lib/navEnv.js";
import { normalizeCardDetailPins } from "../lib/cardDetailPinRegistry.js";
import { BATCH_EDIT_MAX_CARDS } from "../lib/batchLimits.js";
import { toastError, toastSuccess } from "../lib/toast.js";
import pocketCardBg from "../../images/pocketcardbackground.png";

const USE_SB =
  import.meta.env.VITE_USE_SUPABASE === "true" &&
  Boolean(import.meta.env.VITE_SUPABASE_URL) &&
  Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY);

/** Stable empty object so AnnotationEditor is not reset every render when a card has no annotation row yet. */
const EMPTY_ANNOTATIONS = {};

const WB_SPLIT_STORAGE_KEY = "tm_workbench_split_preset";
const WB_FORM_DENSITY_STORAGE_KEY = "tm_workbench_form_density";
const WORKBENCH_QUEUE_STORAGE_KEY = "tm_workbench_queue_id";

/** `lg+` two-column ratio; below `lg` the grid is a single column. */
const WB_SPLIT_GRID_CLASS = {
  balanced: "lg:grid-cols-2 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]",
  image: "lg:grid-cols-[minmax(0,1.35fr)_minmax(0,0.65fr)] xl:grid-cols-[minmax(0,1.45fr)_minmax(0,0.55fr)]",
  form: "lg:grid-cols-[minmax(0,0.65fr)_minmax(0,1.35fr)] xl:grid-cols-[minmax(0,0.55fr)_minmax(0,1.45fr)]",
};

const navLinkClass = ({ isActive }) =>
  `px-3 py-1.5 rounded text-sm font-medium transition-colors ${
    isActive ? "bg-white text-green-700" : "bg-green-700 hover:bg-green-800 text-white"
  }`;

function normalizeCardIds(raw) {
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (raw && typeof raw === "object") return Object.values(raw).filter(Boolean);
  return [];
}

export default function WorkbenchPage() {
  const queryClient = useQueryClient();
  const experimentalNav = useExperimentalAppNav();
  const [activeQueueId, setActiveQueueId] = useState(() => {
    try {
      return typeof localStorage !== "undefined"
        ? localStorage.getItem(WORKBENCH_QUEUE_STORAGE_KEY) || ""
        : "";
    } catch {
      return "";
    }
  });
  const [manageListMode, setManageListMode] = useState(false);
  const [selectedForRemoval, setSelectedForRemoval] = useState(() => new Set());
  const [manageSearchQuery, setManageSearchQuery] = useState("");
  const [moveTargetQueueId, setMoveTargetQueueId] = useState("");
  const [showMoveTargetPicker, setShowMoveTargetPicker] = useState(false);

  /** Phase 5: persistent save status in Workbench chrome (driven by AnnotationEditor). */
  const [annotationSave, setAnnotationSave] = useState({
    phase: "idle",
    detail: null,
    savedAt: null,
    retry: null,
  });

  const onAnnotationSaveStatus = useCallback((payload) => {
    setAnnotationSave({
      phase: payload.phase || "idle",
      detail: payload.detail ?? null,
      savedAt: payload.savedAt ?? null,
      retry: payload.retry ?? null,
    });
  }, []);

  const [splitPreset, setSplitPreset] = useState(() => {
    try {
      const v = typeof localStorage !== "undefined" && localStorage.getItem(WB_SPLIT_STORAGE_KEY);
      if (v === "image" || v === "form" || v === "balanced") return v;
    } catch {
      /* ignore */
    }
    return "balanced";
  });
  const [formDensity, setFormDensity] = useState(() => {
    try {
      const v = typeof localStorage !== "undefined" && localStorage.getItem(WB_FORM_DENSITY_STORAGE_KEY);
      if (v === "compact" || v === "comfortable") return v;
    } catch {
      /* ignore */
    }
    return "comfortable";
  });
  const [, startUiTransition] = useTransition();
  const magnifierLensRef = useRef(null);
  const magnifierFrameRef = useRef(0);
  const magnifierPointerRef = useRef({
    clientX: 0,
    clientY: 0,
    relX: 0.5,
    relY: 0.5,
  });
  const magnifierImageRef = useRef({
    imgWidth: 1,
    imgHeight: 1,
    src: "",
  });

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(WB_SPLIT_STORAGE_KEY, splitPreset);
      } catch {
        /* ignore */
      }
    }, 120);
    return () => clearTimeout(timer);
  }, [splitPreset]);
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(WB_FORM_DENSITY_STORAGE_KEY, formDensity);
      } catch {
        /* ignore */
      }
    }, 120);
    return () => clearTimeout(timer);
  }, [formDensity]);
  useEffect(
    () => () => {
      if (magnifierFrameRef.current) {
        cancelAnimationFrame(magnifierFrameRef.current);
      }
    },
    []
  );

  const { data: queues = [], isPending, isError, error } = useQuery({
    queryKey: ["workbenchQueues"],
    queryFn: () => fetchWorkbenchQueues(),
    enabled: USE_SB,
    staleTime: 15_000,
  });

  const queue = useMemo(() => {
    if (!queues.length) return null;
    const picked = activeQueueId
      ? queues.find((q) => String(q.id) === String(activeQueueId))
      : null;
    return picked || queues[0];
  }, [queues, activeQueueId]);

  useEffect(() => {
    if (!queue?.id) return;
    setActiveQueueId(String(queue.id));
  }, [queue?.id]);

  useEffect(() => {
    try {
      if (typeof localStorage !== "undefined") {
        if (activeQueueId) localStorage.setItem(WORKBENCH_QUEUE_STORAGE_KEY, activeQueueId);
        else localStorage.removeItem(WORKBENCH_QUEUE_STORAGE_KEY);
      }
    } catch {
      /* ignore */
    }
  }, [activeQueueId]);

  useEffect(() => {
    setSelectedForRemoval(new Set());
    setManageListMode(false);
    setManageSearchQuery("");
    setMoveTargetQueueId("");
    setShowMoveTargetPicker(false);
  }, [queue?.id]);

  const cardIds = useMemo(() => normalizeCardIds(queue?.card_ids), [queue?.card_ids]);

  const rawIndex = Number(queue?.current_index) || 0;
  const safeIndex = cardIds.length
    ? Math.max(0, Math.min(rawIndex, cardIds.length - 1))
    : 0;
  const currentCardId = cardIds.length ? cardIds[safeIndex] : null;

  const { data: cardNamesById = {} } = useQuery({
    queryKey: ["workbenchQueueCardNames", queue?.id, cardIds],
    queryFn: () => fetchCardNamesByIds(cardIds),
    enabled: USE_SB && Boolean(queue?.id) && cardIds.length > 0,
    staleTime: 60_000,
  });
  const { data: cardThumbsById = {} } = useQuery({
    queryKey: ["workbenchQueueCardThumbs", queue?.id, cardIds],
    queryFn: () => fetchCardThumbnailsByIds(cardIds),
    enabled: USE_SB && manageListMode && Boolean(queue?.id) && cardIds.length > 0,
    staleTime: 60_000,
  });
  const filteredManageCardIds = useMemo(() => {
    const term = String(manageSearchQuery || "").trim().toLowerCase();
    if (!term) return cardIds;
    return cardIds.filter((id) => {
      const sid = String(id || "");
      const name = String(cardNamesById[id] || "");
      return sid.toLowerCase().includes(term) || name.toLowerCase().includes(term);
    });
  }, [cardIds, manageSearchQuery, cardNamesById]);
  const moveTargetOptions = useMemo(
    () => queues.filter((q) => String(q.id) !== String(queue?.id || "")),
    [queues, queue?.id]
  );
  const ownedQueues = useMemo(
    () => queues.filter((q) => q?.is_owner !== false),
    [queues]
  );
  const sharedQueues = useMemo(
    () => queues.filter((q) => q?.is_owner === false),
    [queues]
  );
  useEffect(() => {
    if (!moveTargetOptions.length) {
      setMoveTargetQueueId("");
      return;
    }
    const stillValid = moveTargetOptions.some((q) => String(q.id) === String(moveTargetQueueId));
    if (!stillValid) setMoveTargetQueueId(String(moveTargetOptions[0].id));
  }, [moveTargetOptions, moveTargetQueueId]);

  useEffect(() => {
    setAnnotationSave({ phase: "idle", detail: null, savedAt: null, retry: null });
  }, [currentCardId]);

  const { data: card, isPending: cardLoading, isError: cardError, error: cardErr } = useQuery({
    queryKey: ["workbenchCard", currentCardId],
    queryFn: () => fetchCard(currentCardId, "TCG"),
    enabled: USE_SB && Boolean(currentCardId),
  });

  const { data: myProfile } = useQuery({
    queryKey: ["profile", "me"],
    queryFn: fetchProfile,
    staleTime: 60_000,
    enabled: USE_SB,
  });

  const annotationEditorDisplayName = useMemo(() => {
    if (!card) return null;
    const uid = card.annotations?.updated_by;
    if (uid && myProfile?.id === uid) return myProfile.display_name ?? null;
    return card.annotation_editor_display_name ?? null;
  }, [card, myProfile]);

  const { data: attributes = [] } = useQuery({
    queryKey: ["attributes"],
    queryFn: fetchAttributes,
    enabled: USE_SB,
  });

  const { data: formOptions } = useQuery({
    queryKey: FORM_OPTIONS_QUERY_KEY,
    queryFn: fetchFormOptions,
    enabled: USE_SB,
    staleTime: 300_000,
  });

  const { data: userPrefs } = useQuery({
    queryKey: ["userPreferences"],
    queryFn: fetchUserPreferences,
    enabled: USE_SB,
    staleTime: 30_000,
  });

  const workbenchPinnedKeys = useMemo(
    () => normalizeCardDetailPins(userPrefs?.card_detail_pins),
    [userPrefs?.card_detail_pins]
  );

  const patchQueue = useMutation({
    mutationFn: ({ queueId, patch }) => updateWorkbenchQueue(queueId, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workbenchQueues"] });
    },
    onError: (e) => {
      toastError(e);
    },
  });

  const displayImage =
    card?.annotations?.image_override ||
    card?.image_large ||
    card?.image_small ||
    pocketCardBg;
  const MAGNIFIER_SIZE_PX = 150;
  const MAGNIFIER_ZOOM = 2.1;
  const workbenchPaneHeightClass =
    splitPreset === "image"
      ? "lg:h-[min(84vh,calc(100vh-8.5rem))] xl:h-[min(86vh,calc(100vh-9rem))]"
      : "lg:h-[min(76vh,calc(100vh-10rem))] xl:h-[min(78vh,calc(100vh-11rem))]";
  const imagePreviewMaxWidthClass =
    splitPreset === "image"
      ? "max-w-xl xl:max-w-2xl"
      : splitPreset === "form"
        ? "max-w-sm xl:max-w-md"
        : "max-w-md xl:max-w-lg";
  const isImageMode = splitPreset === "image";
  const hideImageMagnifier = useCallback(() => {
    const lens = magnifierLensRef.current;
    if (lens) lens.style.opacity = "0";
  }, []);
  const paintImageMagnifier = useCallback(() => {
    if (magnifierFrameRef.current) return;
    magnifierFrameRef.current = requestAnimationFrame(() => {
      magnifierFrameRef.current = 0;
      const lens = magnifierLensRef.current;
      if (!lens) return;
      const pointer = magnifierPointerRef.current;
      const image = magnifierImageRef.current;
      lens.style.opacity = "1";
      lens.style.transform = `translate3d(${pointer.clientX}px, ${pointer.clientY}px, 0) translate(-50%, -50%)`;
      lens.style.backgroundImage = `url("${image.src}")`;
      lens.style.backgroundSize = `${image.imgWidth * MAGNIFIER_ZOOM}px ${image.imgHeight * MAGNIFIER_ZOOM}px`;
      lens.style.backgroundPosition = `${MAGNIFIER_SIZE_PX / 2 - pointer.relX * image.imgWidth * MAGNIFIER_ZOOM}px ${MAGNIFIER_SIZE_PX / 2 - pointer.relY * image.imgHeight * MAGNIFIER_ZOOM}px`;
    });
  }, []);
  const handleImageMagnifierMove = useCallback(
    (event) => {
      const rect = event.currentTarget.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      magnifierPointerRef.current = {
        clientX: event.clientX,
        clientY: event.clientY,
        relX: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
        relY: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
      };
      magnifierImageRef.current = {
        imgWidth: rect.width,
        imgHeight: rect.height,
        src: displayImage,
      };
      paintImageMagnifier();
    },
    [displayImage, paintImageMagnifier]
  );
  useEffect(() => {
    if (!isImageMode) {
      hideImageMagnifier();
    }
  }, [isImageMode, hideImageMagnifier]);

  const goPrev = () => {
    if (!queue?.id || safeIndex <= 0) return;
    patchQueue.mutate({ queueId: queue.id, patch: { current_index: safeIndex - 1 } });
  };

  const goNext = () => {
    if (!queue?.id || safeIndex >= cardIds.length - 1) return;
    patchQueue.mutate({ queueId: queue.id, patch: { current_index: safeIndex + 1 } });
  };

  const removeCurrentFromQueue = () => {
    if (!queue?.id || !currentCardId) return;
    const newIds = cardIds.filter((id) => id !== currentCardId);
    const newIndex = newIds.length ? Math.min(safeIndex, newIds.length - 1) : 0;
    patchQueue.mutate({
      queueId: queue.id,
      patch: { card_ids: newIds, current_index: newIndex },
    });
  };

  const allRemovalSelected =
    filteredManageCardIds.length > 0 &&
    filteredManageCardIds.every((id) => selectedForRemoval.has(String(id)));

  const toggleRemoveSelection = (cardId, checked) => {
    const id = String(cardId);
    setSelectedForRemoval((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleSelectAllForRemoval = (checked) => {
    if (!checked) {
      setSelectedForRemoval(new Set());
      return;
    }
    setSelectedForRemoval((prev) => {
      const next = new Set(prev);
      for (const id of filteredManageCardIds) next.add(String(id));
      return next;
    });
  };

  const undoBulkRemove = async (snapshot) => {
    try {
      await updateWorkbenchQueue(snapshot.queueId, {
        card_ids: snapshot.cardIds,
        current_index: snapshot.currentIndex,
      });
      await queryClient.invalidateQueries({ queryKey: ["workbenchQueues"] });
      toastSuccess(`Restored ${snapshot.removedCount} card${snapshot.removedCount === 1 ? "" : "s"}.`);
    } catch (e) {
      toastError(e);
    }
  };

  const handleBulkRemoveSelected = async () => {
    if (!queue?.id || selectedForRemoval.size === 0) return;
    const selected = new Set([...selectedForRemoval].map((id) => String(id)));
    const nextIds = cardIds.filter((id) => !selected.has(String(id)));
    const removedCount = cardIds.length - nextIds.length;
    if (removedCount <= 0) return;
    const currentIndex = safeIndex;
    const nextIndex = nextIds.length ? Math.min(currentIndex, nextIds.length - 1) : 0;
    try {
      await updateWorkbenchQueue(queue.id, {
        card_ids: nextIds,
        current_index: nextIndex,
      });
      await queryClient.invalidateQueries({ queryKey: ["workbenchQueues"] });
      setSelectedForRemoval(new Set());
      const snapshot = {
        queueId: queue.id,
        cardIds: cardIds.map((id) => String(id)),
        currentIndex,
        removedCount,
      };
      toastSuccess(
        `Removed ${removedCount} card${removedCount === 1 ? "" : "s"} from "${queue.name || "list"}".`,
        {
          duration: 8000,
          action: {
            label: "Undo",
            onClick: () => {
              void undoBulkRemove(snapshot);
            },
          },
        }
      );
    } catch (e) {
      toastError(e);
    }
  };

  const handleBulkRemoveMatching = async () => {
    if (!queue?.id || filteredManageCardIds.length === 0) return;
    const selected = new Set(filteredManageCardIds.map((id) => String(id)));
    const nextIds = cardIds.filter((id) => !selected.has(String(id)));
    const removedCount = cardIds.length - nextIds.length;
    if (removedCount <= 0) return;
    const currentIndex = safeIndex;
    const nextIndex = nextIds.length ? Math.min(currentIndex, nextIds.length - 1) : 0;
    try {
      await updateWorkbenchQueue(queue.id, {
        card_ids: nextIds,
        current_index: nextIndex,
      });
      await queryClient.invalidateQueries({ queryKey: ["workbenchQueues"] });
      setSelectedForRemoval(new Set());
      const snapshot = {
        queueId: queue.id,
        cardIds: cardIds.map((id) => String(id)),
        currentIndex,
        removedCount,
      };
      toastSuccess(
        `Removed ${removedCount} matching card${removedCount === 1 ? "" : "s"} from "${queue.name || "list"}".`,
        {
          duration: 8000,
          action: {
            label: "Undo",
            onClick: () => {
              void undoBulkRemove(snapshot);
            },
          },
        }
      );
    } catch (e) {
      toastError(e);
    }
  };

  const handleMoveSelectedToList = async () => {
    if (!queue?.id || selectedForRemoval.size === 0 || !moveTargetQueueId) return;
    const target = moveTargetOptions.find((q) => String(q.id) === String(moveTargetQueueId));
    if (!target) return;
    const selected = new Set([...selectedForRemoval].map((id) => String(id)));
    const movingIds = cardIds.filter((id) => selected.has(String(id)));
    if (movingIds.length === 0) return;
    const targetIds = normalizeCardIds(target.card_ids).map((id) => String(id));
    const seenTarget = new Set(targetIds);
    const mergedTarget = [...targetIds];
    for (const id of movingIds) {
      const sid = String(id);
      if (!seenTarget.has(sid)) {
        seenTarget.add(sid);
        mergedTarget.push(sid);
      }
    }
    const sourceNextIds = cardIds.filter((id) => !selected.has(String(id)));
    const sourceNextIndex = sourceNextIds.length ? Math.min(safeIndex, sourceNextIds.length - 1) : 0;
    try {
      await updateWorkbenchQueue(target.id, {
        card_ids: mergedTarget,
        current_index: Math.max(0, Number(target.current_index) || 0),
      });
      await updateWorkbenchQueue(queue.id, {
        card_ids: sourceNextIds,
        current_index: sourceNextIndex,
      });
      await queryClient.invalidateQueries({ queryKey: ["workbenchQueues"] });
      setSelectedForRemoval(new Set());
      toastSuccess(
        `Moved ${movingIds.length} card${movingIds.length === 1 ? "" : "s"} to "${target.name || "list"}".`
      );
    } catch (e) {
      toastError(e);
    }
  };

  const moveCardInCurrentQueue = async (cardId, direction) => {
    if (!queue?.id) return;
    const from = cardIds.findIndex((id) => String(id) === String(cardId));
    if (from < 0) return;
    const to = direction === "up" ? from - 1 : from + 1;
    if (to < 0 || to >= cardIds.length) return;
    const nextIds = [...cardIds];
    const [moved] = nextIds.splice(from, 1);
    nextIds.splice(to, 0, moved);
    const currentId = currentCardId ? String(currentCardId) : null;
    const nextIndex = currentId
      ? Math.max(0, nextIds.findIndex((id) => String(id) === currentId))
      : safeIndex;
    try {
      await updateWorkbenchQueue(queue.id, {
        card_ids: nextIds,
        current_index: nextIndex < 0 ? 0 : nextIndex,
      });
      await queryClient.invalidateQueries({ queryKey: ["workbenchQueues"] });
    } catch (e) {
      toastError(e);
    }
  };

  const handleCreateQueue = async () => {
    const raw = window.prompt("New Workbench list name:", "Shared list");
    if (raw == null) return;
    const name = String(raw).trim();
    if (!name) return;
    try {
      const row = await createWorkbenchQueue({ name });
      await queryClient.invalidateQueries({ queryKey: ["workbenchQueues"] });
      if (row?.id != null) setActiveQueueId(String(row.id));
    } catch (e) {
      toastError(e);
    }
  };

  const handleRenameQueue = async () => {
    if (!queue?.id) return;
    if (queue?.is_owner === false) {
      toastError("Only the list owner can rename this shared list.");
      return;
    }
    const raw = window.prompt("Rename Workbench list:", queue.name || "Shared list");
    if (raw == null) return;
    const name = String(raw).trim();
    if (!name || name === String(queue.name || "").trim()) return;
    try {
      await updateWorkbenchQueue(queue.id, { name });
      await queryClient.invalidateQueries({ queryKey: ["workbenchQueues"] });
    } catch (e) {
      toastError(e);
    }
  };

  const handleDeleteQueue = async () => {
    if (!queue?.id) return;
    if (queue?.is_owner === false) {
      toastError("Only the list owner can delete this shared list.");
      return;
    }
    if (queues.length <= 1) {
      toastError("Create another list before deleting this one.");
      return;
    }
    const ok = window.confirm(`Delete list "${queue.name || "Untitled list"}"? This removes cards from this list only.`);
    if (!ok) return;
    try {
      const fallback = queues.find((q) => String(q.id) !== String(queue.id));
      await deleteWorkbenchQueue(queue.id);
      await queryClient.invalidateQueries({ queryKey: ["workbenchQueues"] });
      if (fallback?.id != null) setActiveQueueId(String(fallback.id));
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      {!experimentalNav ? (
        <header className="bg-green-600 text-white shadow-lg">
          <div className="max-w-7xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <img
                src={`${import.meta.env.BASE_URL}favicon.png`}
                alt="Tropius"
                className="h-12 w-12 rounded-full object-cover"
              />
              <div>
                <h1 className="text-xl font-bold tracking-tight">Workbench</h1>
                <p className="text-green-100 text-xs">Annotate cards in a focused list</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <nav className="flex items-center gap-2">
                <NavLink to="/" className={navLinkClass} end>
                  Explore
                </NavLink>
                <NavLink to="/workbench" className={navLinkClass}>
                  Workbench
                </NavLink>
                <NavLink to="/health" className={navLinkClass}>
                  Data Health
                </NavLink>
                <NavLink to="/fields" className={navLinkClass}>
                  Fields
                </NavLink>
                <NavLink to="/batch" className={navLinkClass}>
                  Batch
                </NavLink>
                <NavLink to="/history" className={navLinkClass}>
                  History
                </NavLink>
              </nav>
              <AuthUserMenu />
            </div>
          </div>
        </header>
      ) : null}

      <main className="max-w-7xl mx-auto px-4 py-6">
        {experimentalNav ? (
          <div className="mb-6 rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">Workbench</h1>
            <p className="text-gray-600 text-xs mt-0.5">Annotate cards in a focused list</p>
          </div>
        ) : null}
        {!USE_SB && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Workbench lists use Supabase. Set <code className="font-mono">VITE_USE_SUPABASE=true</code> and
            your Supabase env vars, then sign in.
          </div>
        )}

        <div className="mb-4">
          <WorkflowModeHelp summary="About Workbench — when to use it">
            <p>
              Workbench uses <strong>shared lists</strong> of cards you work through in order: large artwork, full
              annotation form, and <strong>Previous / Next</strong> without returning to the grid each time.
            </p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                <strong>Adding cards:</strong> on Explore, open a card, then choose <strong>Send to Workbench</strong>.
                That appends the card to your selected list (you can remove it from the list here later).
              </li>
              <li>
                <strong>Use Workbench</strong> when you already know <em>which</em> cards need work (backlog, QA
                list, or cards you sent from Explore) and want a focused editing pass.
              </li>
              <li>
                <strong>Use Explore / card detail</strong> for quick fixes while browsing, or when you are still{" "}
                <strong>discovering</strong> cards. Same data—Workbench is for list-driven sessions.
              </li>
              <li>
                <strong>Batch</strong> is different: it applies <strong>one field</strong> to <strong>all cards matching
                your Explore filters</strong>, not a hand-built list.
              </li>
            </ul>
            {!USE_SB && (
              <p className="text-gray-600 text-xs border-t border-gray-100 pt-2 mt-2">
                Turn on Supabase in this deployment to load and save your lists.
              </p>
            )}
          </WorkflowModeHelp>
        </div>

        {USE_SB && isPending && <p className="text-sm text-gray-500">Loading list…</p>}

        {USE_SB && isError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error?.message || "Could not load Workbench list."}
          </div>
        )}

        {USE_SB && !isPending && !isError && !queue && (
          <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-700 space-y-3">
            <p>No Workbench lists yet. Create one to start a shared list.</p>
            <div>
              <Button type="button" variant="primary" size="sm" onClick={handleCreateQueue}>
                Create first list
              </Button>
            </div>
          </div>
        )}

        {USE_SB && queue && (
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex flex-wrap items-center gap-2 min-w-[18rem]">
              <label className="text-xs font-medium text-gray-500">List</label>
              <select
                value={queue?.id ?? ""}
                onChange={(e) => setActiveQueueId(String(e.target.value))}
                className="h-9 min-w-[14rem] max-w-[20rem] px-2.5 border border-gray-300 rounded-lg bg-white text-sm"
              >
                {ownedQueues.length > 0 && (
                  <optgroup label="My lists">
                    {ownedQueues.map((q) => (
                      <option key={q.id} value={q.id}>
                        {q.name || "Untitled list"}
                      </option>
                    ))}
                  </optgroup>
                )}
                {sharedQueues.length > 0 && (
                  <optgroup label="Shared with me">
                    {sharedQueues.map((q) => (
                      <option key={q.id} value={q.id}>
                        {q.name || "Untitled list"}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              {queue?.is_shared ? (
                <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">
                  Shared
                </span>
              ) : null}
              <label
                className="inline-flex items-center gap-1.5 text-xs text-gray-600"
                title={
                  queue?.is_owner === false
                    ? "Only the list owner can change sharing."
                    : "Only lists marked shared are visible to teammates."
                }
              >
                <input
                  type="checkbox"
                  checked={Boolean(queue?.is_shared)}
                  disabled={queue?.is_owner === false}
                  onChange={async (e) => {
                    if (!queue?.id) return;
                    try {
                      await updateWorkbenchQueue(queue.id, { is_shared: e.target.checked });
                      await queryClient.invalidateQueries({ queryKey: ["workbenchQueues"] });
                    } catch (err) {
                      toastError(err);
                    }
                  }}
                  className="rounded border-gray-300 text-green-600 focus:ring-green-600 disabled:opacity-40 disabled:cursor-not-allowed"
                />
                Shared with team
              </label>
              <span className="hidden md:inline-block h-5 w-px bg-gray-200 mx-0.5" aria-hidden />
              <Button type="button" variant="secondary" size="sm" onClick={handleCreateQueue}>
                New
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleRenameQueue}
                disabled={queue?.is_owner === false}
                title={queue?.is_owner === false ? "Only the list owner can rename this shared list." : undefined}
              >
                Rename
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleDeleteQueue}
                disabled={queue?.is_owner === false}
                title={queue?.is_owner === false ? "Only the list owner can delete this shared list." : undefined}
              >
                Delete
              </Button>
              {queue?.is_owner === false ? (
                <p className="basis-full text-[11px] text-gray-500">
                  Owner-only settings are locked on shared lists. You can still add, remove, and reorder cards.
                </p>
              ) : null}
            </div>
            <p className="text-sm text-gray-600">
              <span className="tabular-nums">{cardIds.length}</span> /{" "}
              <span className="tabular-nums">{BATCH_EDIT_MAX_CARDS.toLocaleString()}</span> card
              {cardIds.length !== 1 ? "s" : ""}
              {cardIds.length > 0 && (
                <>
                  {" · "}
                  <span className="tabular-nums">{safeIndex + 1}</span> /{" "}
                  <span className="tabular-nums">{cardIds.length}</span>
                </>
              )}
            </p>
            {cardIds.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={goPrev}
                  disabled={safeIndex <= 0 || patchQueue.isPending}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 bg-white
                    hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                  Previous
                </button>
                <button
                  type="button"
                  onClick={goNext}
                  disabled={safeIndex >= cardIds.length - 1 || patchQueue.isPending}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 bg-white
                    hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next
                  <ChevronRight className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={removeCurrentFromQueue}
                  disabled={patchQueue.isPending}
                  className="px-3 py-1.5 text-sm font-medium rounded-lg border border-red-200 bg-white
                    text-red-700 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Remove from list
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setManageListMode((v) => !v);
                    setSelectedForRemoval(new Set());
                    setManageSearchQuery("");
                    setShowMoveTargetPicker(false);
                  }}
                  disabled={patchQueue.isPending}
                  className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 bg-white
                    text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {manageListMode ? "Done managing" : "Manage list"}
                </button>
              </div>
            )}
          </div>
        )}

        {USE_SB && queue && cardIds.length > 0 && manageListMode && (
          <div className="mb-4 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <input
                type="text"
                value={manageSearchQuery}
                onChange={(e) => setManageSearchQuery(e.target.value)}
                placeholder="Filter by card name or id"
                className="h-9 min-w-[16rem] flex-1 max-w-md rounded-lg border border-gray-300 px-3 text-sm"
              />
              <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={allRemovalSelected}
                  onChange={(e) => toggleSelectAllForRemoval(e.target.checked)}
                  className="rounded border-gray-300 text-green-600 focus:ring-green-600"
                />
                Select all visible ({filteredManageCardIds.length})
              </label>
            </div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleBulkRemoveSelected()}
                disabled={selectedForRemoval.size === 0 || patchQueue.isPending}
                className="px-3 py-1.5 text-sm font-medium rounded-lg border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Remove selected ({selectedForRemoval.size})
              </button>
              <button
                type="button"
                onClick={() => void handleBulkRemoveMatching()}
                disabled={filteredManageCardIds.length === 0 || patchQueue.isPending}
                className="px-3 py-1.5 text-sm font-medium rounded-lg border border-red-200 bg-white text-red-700 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
                title="Remove all currently visible (filtered) cards from this list"
              >
                Remove all matching ({filteredManageCardIds.length})
              </button>
              {moveTargetOptions.length > 0 && (
                <>
                  {!showMoveTargetPicker ? (
                    <button
                      type="button"
                      onClick={() => setShowMoveTargetPicker(true)}
                      disabled={selectedForRemoval.size === 0 || patchQueue.isPending}
                      className="px-3 py-1.5 text-sm font-medium rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Move selected
                    </button>
                  ) : (
                    <div className="inline-flex items-center gap-1.5">
                      <select
                        value={moveTargetQueueId}
                        onChange={(e) => setMoveTargetQueueId(e.target.value)}
                        className="h-9 min-w-[12rem] rounded-lg border border-blue-200 bg-blue-50 px-2.5 text-sm text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-300"
                      >
                        {moveTargetOptions.map((q) => (
                          <option key={q.id} value={q.id}>
                            {q.name || "Untitled list"}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => void handleMoveSelectedToList()}
                        disabled={selectedForRemoval.size === 0 || !moveTargetQueueId || patchQueue.isPending}
                        className="px-3 py-1.5 text-sm font-medium rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Confirm move
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowMoveTargetPicker(false)}
                        className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-100">
              {filteredManageCardIds.length === 0 ? (
                <p className="px-3 py-4 text-sm text-gray-500">No cards match this filter in the current list.</p>
              ) : (
                <ul className="divide-y divide-gray-100 text-sm">
                  {filteredManageCardIds.map((id) => (
                    <li key={`bulk-remove-${id}`} className="px-2.5 py-2 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedForRemoval.has(String(id))}
                      onChange={(e) => toggleRemoveSelection(id, e.target.checked)}
                      className="rounded border-gray-300 text-green-600 focus:ring-green-600"
                    />
                    {cardThumbsById[id]?.image_small || cardThumbsById[id]?.image_large ? (
                      <img
                        src={cardThumbsById[id]?.image_small || cardThumbsById[id]?.image_large}
                        alt={cardNamesById[id] || id}
                        className="w-6 h-8 rounded border border-gray-200 object-cover bg-white shrink-0"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-6 h-8 rounded border border-gray-200 bg-gray-100 shrink-0" />
                    )}
                    <span className="font-mono text-xs text-gray-600">{id}</span>
                    <span className="text-gray-800 truncate">{cardNamesById[id] || "Unknown card"}</span>
                    <div className="ml-auto inline-flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => void moveCardInCurrentQueue(id, "up")}
                        className="rounded border border-gray-300 bg-white p-1 text-gray-600 hover:bg-gray-50 disabled:opacity-35 disabled:cursor-not-allowed"
                        disabled={cardIds.findIndex((x) => String(x) === String(id)) <= 0 || patchQueue.isPending}
                        title="Move up in list"
                      >
                        <ChevronUp className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => void moveCardInCurrentQueue(id, "down")}
                        className="rounded border border-gray-300 bg-white p-1 text-gray-600 hover:bg-gray-50 disabled:opacity-35 disabled:cursor-not-allowed"
                        disabled={
                          cardIds.findIndex((x) => String(x) === String(id)) >= cardIds.length - 1 ||
                          patchQueue.isPending
                        }
                        title="Move down in list"
                      >
                        <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                      </button>
                    </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className="mt-2 text-xs text-gray-500">
              Removes cards from this list only (cards stay in the database). Bulk remove includes Undo in toast.
            </p>
          </div>
        )}

        {USE_SB && queue && cardIds.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-gray-500 text-sm space-y-2">
            <Inbox className="h-10 w-10 mx-auto mb-3 text-gray-300" strokeWidth={1.5} aria-hidden />
            <p>
              List is empty. Go to <NavLink to="/" className="text-green-700 font-semibold underline">Explore</NavLink>
              , open a card, then choose <strong>Send to Workbench</strong>.
            </p>
            <p className="text-xs text-gray-400 max-w-md mx-auto">
              Workbench is not for picking cards from filters—it is a list you build. For bulk changes by filter, use{" "}
              <NavLink to="/batch" className="text-green-700 font-medium underline">
                Batch
              </NavLink>{" "}
              (set filters on Explore first, then open Batch from the nav).
            </p>
          </div>
        )}

        {USE_SB && currentCardId && (
          <>
            <div
              className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm"
              role="group"
              aria-label="Workbench card and form layout options"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-gray-600">Card / form width</span>
                <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
                  {[
                    { id: "image", label: "Image", Icon: ImageIcon },
                    { id: "balanced", label: "Balanced", Icon: Columns2 },
                    { id: "form", label: "Form", Icon: ClipboardList },
                  ].map(({ id, label, Icon }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        startUiTransition(() => setSplitPreset(id));
                      }}
                      className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                        splitPreset === id
                          ? "bg-white text-tm-canopy shadow-sm border border-gray-200/80"
                          : "text-gray-600 hover:text-gray-900"
                      }`}
                      aria-pressed={splitPreset === id}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0 opacity-90" strokeWidth={2} aria-hidden />
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-gray-600">Form density</span>
                <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
                  {[
                    { id: "comfortable", label: "Comfortable" },
                    { id: "compact", label: "Compact" },
                  ].map(({ id, label }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        startUiTransition(() => setFormDensity(id));
                      }}
                      className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                        formDensity === id
                          ? "bg-white text-tm-canopy shadow-sm border border-gray-200/80"
                          : "text-gray-600 hover:text-gray-900"
                      }`}
                      aria-pressed={formDensity === id}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div
              className={`grid grid-cols-1 gap-6 lg:gap-8 lg:items-center min-h-[min(560px,calc(100vh-12rem))] ${
                WB_SPLIT_GRID_CLASS[splitPreset] || WB_SPLIT_GRID_CLASS.balanced
              }`}
            >
            <section
              className={`rounded-xl border border-gray-200 bg-white shadow-sm flex flex-col overflow-hidden min-h-[280px] ${workbenchPaneHeightClass}`}
            >
              <div className="px-4 py-2 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Card
              </div>
              <div
                className={`flex-1 flex flex-col bg-gray-100 min-h-0 ${
                  isImageMode ? "relative p-2" : "items-center justify-center p-4"
                }`}
              >
                {cardLoading && <p className="text-sm text-gray-500">Loading card…</p>}
                {cardError && (
                  <p className="text-sm text-red-600">{cardErr?.message || "Could not load card."}</p>
                )}
                {card && !cardLoading && (
                  <>
                    {isImageMode && (
                      <div className="pointer-events-none absolute left-3 top-3 z-10 max-w-[calc(100%-1.5rem)] rounded-md border border-black/15 bg-black/55 px-2 py-1 text-[11px] leading-tight text-white backdrop-blur-[1px]">
                        <p className="truncate font-semibold">{card.name || "Unknown"}</p>
                        <p className="truncate text-white/90">
                          {[card.set_name, card.number].filter(Boolean).join(" · ") || card.id}
                        </p>
                      </div>
                    )}
                    <div
                      className={`w-full flex-1 min-h-[220px] ${
                        isImageMode
                          ? "overflow-y-auto overflow-x-hidden rounded-lg border border-gray-200 bg-white p-2 cursor-none"
                          : `${imagePreviewMaxWidthClass} flex items-center justify-center`
                      }`}
                    >
                      <img
                        src={displayImage}
                        alt={card.name || "Card"}
                        referrerPolicy="no-referrer"
                        className={
                          isImageMode
                            ? "mx-auto block w-full h-auto object-contain rounded-lg shadow-md bg-white"
                            : "max-h-full max-w-full object-contain rounded-lg shadow-md bg-white"
                        }
                        onMouseEnter={isImageMode ? handleImageMagnifierMove : undefined}
                        onMouseMove={isImageMode ? handleImageMagnifierMove : undefined}
                        onMouseLeave={isImageMode ? hideImageMagnifier : undefined}
                        onError={(e) => {
                          if (e.target.src !== pocketCardBg) e.target.src = pocketCardBg;
                        }}
                      />
                    </div>
                    {isImageMode && (
                      <div
                        ref={magnifierLensRef}
                        className="fixed z-30 pointer-events-none rounded-full border-2 border-white/95 shadow-[0_8px_28px_rgba(0,0,0,0.45)] ring-1 ring-black/35"
                        style={{
                          width: `${MAGNIFIER_SIZE_PX}px`,
                          height: `${MAGNIFIER_SIZE_PX}px`,
                          left: "0px",
                          top: "0px",
                          transform: "translate(-50%, -50%)",
                          backgroundImage: `url("${displayImage}")`,
                          backgroundRepeat: "no-repeat",
                          backgroundSize: `${MAGNIFIER_ZOOM * 100}% auto`,
                          backgroundPosition: "50% 50%",
                          opacity: 0,
                          willChange: "transform, background-position",
                        }}
                      />
                    )}
                    {!isImageMode && (
                      <div className="mt-3 text-center w-full px-2">
                        <p className="font-semibold text-gray-900 truncate">{card.name || "Unknown"}</p>
                        <p className="text-xs text-gray-500 truncate">
                          {[card.set_name, card.number].filter(Boolean).join(" · ") || card.id}
                        </p>
                        <div className="mt-1 max-w-md mx-auto text-center">
                          <CardAttributionLine
                            createdById={card.created_by}
                            creatorDisplayName={card.creator_display_name}
                            annotationUpdatedById={card.annotations?.updated_by}
                            annotationUpdatedByName={annotationEditorDisplayName}
                            annotationUpdatedAt={card.annotations?.updated_at}
                          />
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </section>

            <section
              className={`rounded-xl border border-gray-200 bg-white shadow-sm flex flex-col overflow-hidden min-h-[280px] ${workbenchPaneHeightClass}`}
            >
              <div className="px-4 py-2.5 border-b border-gray-100 shrink-0 flex flex-wrap items-center justify-between gap-2 bg-white">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Annotations</span>
                <div className="flex flex-wrap items-center justify-end gap-2 min-w-0 flex-1">
                  {annotationSave.phase === "idle" && (
                    <span className="text-xs text-gray-400 tabular-nums">Ready to save on change</span>
                  )}
                  {annotationSave.phase === "saving" && (
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-800">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-600 shrink-0" aria-hidden />
                      Saving…
                    </span>
                  )}
                  {annotationSave.phase === "saved" && annotationSave.savedAt && (
                    <span className="text-xs font-medium text-tm-success tabular-nums">
                      Saved {annotationSave.savedAt.toLocaleTimeString()}
                    </span>
                  )}
                  {annotationSave.phase === "noop" && (
                    <span className="text-xs text-gray-500 tabular-nums">No changes</span>
                  )}
                  {annotationSave.phase === "error" && (
                    <span className="flex flex-wrap items-center justify-end gap-2 min-w-0">
                      <span className="text-xs text-tm-danger text-right leading-snug max-w-[min(100%,20rem)]">
                        {annotationSave.detail || "Could not save."}
                      </span>
                      {typeof annotationSave.retry === "function" && (
                        <Button type="button" variant="secondary" size="sm" onClick={() => annotationSave.retry?.()}>
                          Retry
                        </Button>
                      )}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto overscroll-contain p-4 min-h-0">
                {card && (
                  <AnnotationEditor
                    key={currentCardId}
                    cardId={currentCardId}
                    annotations={card.annotations ?? EMPTY_ANNOTATIONS}
                    attributes={attributes}
                    formOptions={formOptions || {}}
                    pinnedKeys={workbenchPinnedKeys}
                    density={formDensity}
                    onSaveStatusChange={onAnnotationSaveStatus}
                  />
                )}
              </div>
            </section>
          </div>
          </>
        )}
      </main>
    </div>
  );
}
