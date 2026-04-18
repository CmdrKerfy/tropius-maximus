/**
 * Workbench — Phase 5: queue-backed annotation editing (Supabase).
 */

import { useMemo } from "react";
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
import { useExperimentalAppNav } from "../lib/navEnv.js";
import pocketCardBg from "../../images/pocketcardbackground.png";

const USE_SB =
  import.meta.env.VITE_USE_SUPABASE === "true" &&
  Boolean(import.meta.env.VITE_SUPABASE_URL) &&
  Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY);

/** Stable empty object so AnnotationEditor is not reset every render when a card has no annotation row yet. */
const EMPTY_ANNOTATIONS = {};

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
                  className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 bg-white
                    hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={goNext}
                  disabled={safeIndex >= cardIds.length - 1 || patchQueue.isPending}
                  className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 bg-white
                    hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next
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
            Queue is empty. From Explore, open a card and choose <strong>Send to Workbench</strong>.
          </div>
        )}

        {USE_SB && currentCardId && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-[min(520px,calc(100vh-11rem))]">
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
                    <div className="w-full max-w-sm flex-1 min-h-[200px] flex items-center justify-center">
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

            <section className="rounded-xl border border-gray-200 bg-white shadow-sm flex flex-col overflow-hidden min-h-[280px] max-h-[calc(100vh-10rem)]">
              <div className="px-4 py-2 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide shrink-0">
                Annotations
              </div>
              <div className="flex-1 overflow-y-auto p-4 min-h-0">
                {card && (
                  <AnnotationEditor
                    key={currentCardId}
                    cardId={currentCardId}
                    annotations={card.annotations ?? EMPTY_ANNOTATIONS}
                    attributes={attributes}
                    formOptions={formOptions || {}}
                  />
                )}
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
