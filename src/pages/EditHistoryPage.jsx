/**
 * Edit history — recent annotation field changes from `edit_history` (Supabase).
 */

import { useMemo, useState } from "react";
import { NavLink, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchEditHistory } from "../db";
import AuthUserMenu from "../components/AuthUserMenu.jsx";

const USE_SB =
  import.meta.env.VITE_USE_SUPABASE === "true" &&
  Boolean(import.meta.env.VITE_SUPABASE_URL) &&
  Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY);

const navLinkClass = ({ isActive }) =>
  `px-3 py-1.5 rounded text-sm font-medium transition-colors ${
    isActive ? "bg-white text-green-700" : "bg-green-700 hover:bg-green-800 text-white"
  }`;

function previewText(s, max = 80) {
  if (s == null || s === "") return "—";
  const t = String(s);
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

export default function EditHistoryPage() {
  const [cardFilter, setCardFilter] = useState("");
  const [onlyMine, setOnlyMine] = useState(false);

  const queryParams = useMemo(() => {
    const id = cardFilter.trim();
    const base = id ? { card_id: id, limit: 300, only_mine: onlyMine } : { limit: 200, only_mine: onlyMine };
    return base;
  }, [cardFilter, onlyMine]);

  const { data: rows = [], isPending, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["editHistory", queryParams],
    queryFn: () => fetchEditHistory(queryParams),
    enabled: USE_SB,
    staleTime: 15_000,
  });

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="bg-green-600 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <img
              src={`${import.meta.env.BASE_URL}favicon.png`}
              alt="Tropius"
              className="h-12 w-12 rounded-full object-cover"
            />
            <div>
              <h1 className="text-xl font-bold tracking-tight">Edit history</h1>
              <p className="text-green-100 text-xs">Annotation field changes (newest first)</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <nav className="flex flex-wrap items-center gap-2">
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

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-4">
        {!USE_SB && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Edit history uses Supabase. Set <code className="font-mono">VITE_USE_SUPABASE=true</code> and your
            Supabase env vars, then sign in.
          </div>
        )}

        {USE_SB && (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                  Filter by card ID
                </label>
                <input
                  type="text"
                  value={cardFilter}
                  onChange={(e) => setCardFilter(e.target.value)}
                  placeholder="Leave empty for recent edits across all cards"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none pb-2">
                <input
                  type="checkbox"
                  checked={onlyMine}
                  onChange={(e) => setOnlyMine(e.target.checked)}
                  className="rounded border-gray-300 text-green-600 focus:ring-green-600"
                />
                Only my edits
              </label>
              <button
                type="button"
                onClick={() => refetch()}
                disabled={isFetching}
                className="px-3 py-2 text-sm font-medium rounded-lg border border-gray-300 bg-white hover:bg-gray-50
                  disabled:opacity-50"
              >
                Refresh
              </button>
            </div>

            <p className="text-xs text-gray-500">
              Values are stored as text (JSON for lists/objects). Opens in Explore with the card drawer when you
              follow a card link.
            </p>

            {isPending && <p className="text-sm text-gray-500">Loading…</p>}
            {isError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {error?.message || "Could not load history."}
              </div>
            )}

            {!isPending && !isError && rows.length === 0 && (
              <p className="text-sm text-gray-600">
                No rows yet. History is recorded when you save annotations in Workbench or Card Detail (Supabase
                mode).
              </p>
            )}

            {!isPending && !isError && rows.length > 0 && (
              <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-xs text-gray-500 uppercase">
                      <th className="px-3 py-2 font-medium whitespace-nowrap">When</th>
                      <th className="px-3 py-2 font-medium">Editor</th>
                      <th className="px-3 py-2 font-medium">Card</th>
                      <th className="px-3 py-2 font-medium">Field</th>
                      <th className="px-3 py-2 font-medium">Old</th>
                      <th className="px-3 py-2 font-medium">New</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {rows.map((r) => (
                      <tr key={`${String(r.id)}-${r.edited_at}`} className="align-top">
                        <td className="px-3 py-2 text-gray-600 whitespace-nowrap tabular-nums text-xs">
                          {r.edited_at
                            ? new Date(r.edited_at).toLocaleString(undefined, {
                                dateStyle: "short",
                                timeStyle: "short",
                              })
                            : "—"}
                        </td>
                        <td className="px-3 py-2 text-gray-800 text-xs max-w-[140px] break-words" title={r.edited_by || ""}>
                          {r.editor_display_name?.trim()
                            ? r.editor_display_name
                            : r.edited_by
                              ? previewText(r.edited_by, 12)
                              : "—"}
                        </td>
                        <td className="px-3 py-2">
                          <Link
                            to={`/?card=${encodeURIComponent(r.card_id)}`}
                            className="text-green-700 font-mono text-xs break-all hover:underline"
                          >
                            {previewText(r.card_id, 36)}
                          </Link>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-gray-800">{r.field_name}</td>
                        <td className="px-3 py-2 text-gray-700 max-w-[200px] break-words" title={r.old_value ?? ""}>
                          {previewText(r.old_value)}
                        </td>
                        <td className="px-3 py-2 text-gray-800 max-w-[200px] break-words" title={r.new_value ?? ""}>
                          {previewText(r.new_value)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
