/**
 * Workbench — Phase 5: queue-backed annotation editing (Supabase).
 */

import { useMemo, useState, useEffect, useCallback } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Columns2,
  Image as ImageIcon,
  Inbox,
  Loader2,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ensureDefaultWorkbenchQueue,
  fetchCard,
  fetchAttributes,
  fetchFormOptions,
  updateWorkbenchQueue,
} from "../db";
import AnnotationEditor from "../components/AnnotationEditor";
import AuthUserMenu from "../components/AuthUserMenu.jsx";
import Button from "../components/ui/Button.jsx";
import { useExperimentalAppNav } from "../lib/navEnv.js";
import { toastError } from "../lib/toast.js";
import pocketCardBg from "../../images/pocketcardbackground.png";

const USE_SB =
  import.meta.env.VITE_USE_SUPABASE === "true" &&
  Boolean(import.meta.env.VITE_SUPABASE_URL) &&
  Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY);

/** Stable empty object so AnnotationEditor is not reset every render when a card has no annotation row yet. */
const EMPTY_ANNOTATIONS = {};

const WB_SPLIT_STORAGE_KEY = "tm_workbench_split_preset";

/** `lg+` two-column ratio; below `lg` the grid is a single column. */
const WB_SPLIT_GRID_CLASS = {
  balanced: "lg:grid-cols-2 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]",
  image: "lg:grid-cols-[minmax(0,1.14fr)_minmax(0,0.86fr)] xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]",
  form: "lg:grid-cols-[minmax(0,0.76fr)_minmax(0,1.24fr)] xl:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]",
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

  useEffect(() => {
    try {
      localStorage.setItem(WB_SPLIT_STORAGE_KEY, splitPreset);
    } catch {
      /* ignore */
    }
  }, [splitPreset]);

  const { data: queue, isPending, isError, error } = useQuery({
    queryKey: ["workbenchQueue", "default"],
    queryFn: () => ensureDefaultWorkbenchQueue(),
    enabled: USE_SB,
    staleTime: 15_000,
  });

  const cardIds = useMemo(() => normalizeCardIds(queue?.card_ids), [queue?.card_ids]);

  const rawIndex = Number(queue?.current_index) || 0;
  const safeIndex = cardIds.length
    ? Math.max(0, Math.min(rawIndex, cardIds.length - 1))
    : 0;
  const currentCardId = cardIds.length ? cardIds[safeIndex] : null;

  useEffect(() => {
    setAnnotationSave({ phase: "idle", detail: null, savedAt: null, retry: null });
  }, [currentCardId]);

  const { data: card, isPending: cardLoading, isError: cardError, error: cardErr } = useQuery({
    queryKey: ["workbenchCard", currentCardId],
    queryFn: () => fetchCard(currentCardId, "TCG"),
    enabled: USE_SB && Boolean(currentCardId),
  });

  const { data: attributes = [] } = useQuery({
    queryKey: ["attributes"],
    queryFn: fetchAttributes,
    enabled: USE_SB,
  });

  const { data: formOptions } = useQuery({
    queryKey: ["formOptions"],
    queryFn: fetchFormOptions,
    enabled: USE_SB,
    staleTime: 300_000,
  });

  const patchQueue = useMutation({
    mutationFn: ({ queueId, patch }) => updateWorkbenchQueue(queueId, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workbenchQueue"] });
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
                <p className="text-green-100 text-xs">Annotate cards in a focused queue</p>
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
            <p className="text-gray-600 text-xs mt-0.5">Annotate cards in a focused queue</p>
          </div>
        ) : null}
        {!USE_SB && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Workbench queues use Supabase. Set <code className="font-mono">VITE_USE_SUPABASE=true</code> and
            your Supabase env vars, then sign in.
          </div>
        )}

        {USE_SB && isPending && <p className="text-sm text-gray-500">Loading queue…</p>}

        {USE_SB && isError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error?.message || "Could not load workbench queue."}
          </div>
        )}

        {USE_SB && queue && (
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <p className="text-sm text-gray-600">
              Queue <span className="font-medium text-gray-800">{queue.name}</span>
              {" · "}
              <span className="tabular-nums">{cardIds.length}</span> card{cardIds.length !== 1 ? "s" : ""}
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
                  Remove from queue
                </button>
              </div>
            )}
          </div>
        )}

        {USE_SB && queue && cardIds.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-gray-500 text-sm">
            <Inbox className="h-10 w-10 mx-auto mb-3 text-gray-300" strokeWidth={1.5} aria-hidden />
            Queue is empty. From Explore, open a card and choose <strong>Send to Workbench</strong>.
          </div>
        )}

        {USE_SB && currentCardId && (
          <>
            <div
              className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm"
              role="group"
              aria-label="Workbench card and form column widths"
            >
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
                    onClick={() => setSplitPreset(id)}
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

            <div
              className={`grid grid-cols-1 gap-6 lg:gap-8 min-h-[min(560px,calc(100vh-12rem))] ${
                WB_SPLIT_GRID_CLASS[splitPreset] || WB_SPLIT_GRID_CLASS.balanced
              }`}
            >
            <section className="rounded-xl border border-gray-200 bg-white shadow-sm flex flex-col overflow-hidden min-h-[280px]">
              <div className="px-4 py-2 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Card
              </div>
              <div className="flex-1 flex flex-col items-center justify-center bg-gray-100 p-4 min-h-0">
                {cardLoading && <p className="text-sm text-gray-500">Loading card…</p>}
                {cardError && (
                  <p className="text-sm text-red-600">{cardErr?.message || "Could not load card."}</p>
                )}
                {card && !cardLoading && (
                  <>
                    <div className="w-full max-w-md xl:max-w-lg flex-1 min-h-[220px] flex items-center justify-center">
                      <img
                        src={displayImage}
                        alt={card.name || "Card"}
                        referrerPolicy="no-referrer"
                        className="max-h-full max-w-full object-contain rounded-lg shadow-md bg-white"
                        onError={(e) => {
                          if (e.target.src !== pocketCardBg) e.target.src = pocketCardBg;
                        }}
                      />
                    </div>
                    <div className="mt-3 text-center w-full px-2">
                      <p className="font-semibold text-gray-900 truncate">{card.name || "Unknown"}</p>
                      <p className="text-xs text-gray-500 truncate">
                        {[card.set_name, card.number].filter(Boolean).join(" · ") || card.id}
                      </p>
                    </div>
                  </>
                )}
              </div>
            </section>

            <section className="rounded-xl border border-gray-200 bg-white shadow-sm flex flex-col overflow-hidden min-h-[280px] max-h-[calc(100vh-10rem)] xl:max-h-[calc(100vh-11rem)]">
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
              <div className="flex-1 overflow-y-auto p-4 min-h-0">
                {card && (
                  <AnnotationEditor
                    key={currentCardId}
                    cardId={currentCardId}
                    annotations={card.annotations ?? EMPTY_ANNOTATIONS}
                    attributes={attributes}
                    formOptions={formOptions || {}}
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
