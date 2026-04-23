/**
 * Public read-only card view for /share/card/:cardId (no app chrome, no listing).
 */
import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchPublicCardForShare, useSupabaseBackend } from "../db";
import { absoluteUrl } from "../lib/absoluteUrl.js";

const DEFAULT_TITLE = "Tropius Maximus";
const OG_PLACEHOLDER_PATH = "/og-card-placeholder.svg";

export default function PublicShareCardPage() {
  const { cardId: rawId } = useParams();
  const cardId = rawId ? decodeURIComponent(rawId) : "";
  const supabase = useSupabaseBackend();

  const query = useQuery({
    queryKey: ["publicShareCard", cardId],
    enabled: Boolean(supabase && cardId),
    queryFn: () => fetchPublicCardForShare(cardId),
    staleTime: Infinity,
  });

  const card = query.data;

  useEffect(() => {
    if (!card?.name) {
      document.title = DEFAULT_TITLE;
      return;
    }
    document.title = `${card.name} · ${DEFAULT_TITLE}`;
    return () => {
      document.title = DEFAULT_TITLE;
    };
  }, [card?.name]);

  if (!supabase) {
    return (
      <div className="min-h-dvh bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6">
        <p className="text-center max-w-md text-slate-300">
          Shared card links require the Supabase-backed deployment. Open the main site from your team&apos;s URL.
        </p>
      </div>
    );
  }

  if (!cardId) {
    return (
      <div className="min-h-dvh bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6">
        <p className="text-slate-300">Missing card id.</p>
        <Link to="/" className="mt-4 text-emerald-400 hover:underline">
          Home
        </Link>
      </div>
    );
  }

  if (query.isLoading) {
    return (
      <div className="min-h-dvh bg-slate-950 text-slate-400 flex items-center justify-center">
        Loading…
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="min-h-dvh bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 gap-4">
        <p className="text-red-300 text-center max-w-md">{String(query.error?.message || query.error)}</p>
        <Link to="/" className="text-emerald-400 hover:underline">
          Home
        </Link>
      </div>
    );
  }

  if (!card) {
    return (
      <div className="min-h-dvh bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 gap-4">
        <p className="text-slate-300">Card not found.</p>
        <Link to="/" className="text-emerald-400 hover:underline">
          Home
        </Link>
      </div>
    );
  }

  const img = card.image_override || card.image_large || card.image_small;
  const baseOrigin = typeof window !== "undefined" ? window.location.origin : "";
  const resolved = absoluteUrl(img, baseOrigin);
  const displayImage = resolved || OG_PLACEHOLDER_PATH;
  const subtitle = [card.set_name, card.number ? `#${card.number}` : null].filter(Boolean).join(" · ");

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 px-4 py-3 flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-slate-400 truncate">{DEFAULT_TITLE}</span>
        <Link
          to="/"
          className="text-sm text-emerald-400 hover:text-emerald-300 shrink-0"
        >
          Open app
        </Link>
      </header>

      <main className="max-w-lg mx-auto px-4 py-8 flex flex-col items-center gap-6">
        <img
          src={displayImage}
          alt={card.name || "Card"}
          className="w-full max-w-sm rounded-lg shadow-2xl border border-slate-800 bg-slate-900"
        />

        <div className="text-center space-y-1 w-full">
          <h1 className="text-2xl font-semibold text-white">{card.name}</h1>
          {subtitle ? <p className="text-slate-400 text-sm">{subtitle}</p> : null}
          {card.set_series ? <p className="text-slate-500 text-xs">{card.set_series}</p> : null}
        </div>
      </main>
    </div>
  );
}
