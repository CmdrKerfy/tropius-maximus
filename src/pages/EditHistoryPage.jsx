/**
 * Edit history — recent annotation field changes from `edit_history` (Supabase).
 */

import { useCallback, useMemo, useState } from "react";
import { NavLink, Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchEditHistory, fetchBatchRuns, fetchCardThumbnailsByIds } from "../db";
import AuthUserMenu from "../components/AuthUserMenu.jsx";
import { useExperimentalAppNav } from "../lib/navEnv.js";

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

function cardThumb(entry) {
  return entry?.image_small || entry?.image_large || "";
}

export default function EditHistoryPage() {
  const experimentalNav = useExperimentalAppNav();
  const [searchParams, setSearchParams] = useSearchParams();
  const [historyTab, setHistoryTab] = useState("flat");
  const [expandedRunId, setExpandedRunId] = useState(null);

  const cardFilter = searchParams.get("card") ?? "";
  const sinceFilter = searchParams.get("since") ?? "";
  const fieldFilter = searchParams.get("field") ?? "";
  const runFilter = searchParams.get("run") ?? "";
  const onlyMine = searchParams.get("mine") === "1";

  const setQueryParam = useCallback((key, value) => {
    const next = new URLSearchParams(searchParams);
    const v = value != null ? String(value).trim() : "";
    if (v) next.set(key, v);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const queryParams = useMemo(() => {
    const id = cardFilter.trim();
    const field = fieldFilter.trim();
    const since = sinceFilter.trim();
    const run = runFilter.trim();
    const narrowed = Boolean(id || field || since || run);
    const lim = narrowed ? 300 : 200;
    const base = { limit: lim, only_mine: onlyMine };
    if (id) base.card_id = id;
    if (field) base.field_name = field;
    if (since) base.edited_after = since;
    if (run) base.batch_run_id = run;
    return base;
  }, [cardFilter, fieldFilter, sinceFilter, runFilter, onlyMine]);

  const { data: rows = [], isPending, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["editHistory", queryParams],
    queryFn: () => fetchEditHistory(queryParams),
    enabled: USE_SB && historyTab === "flat",
    staleTime: 15_000,
  });

  const { data: batchRuns = [], isPending: runsPending } = useQuery({
    queryKey: ["batchRuns"],
    queryFn: () => fetchBatchRuns({ limit: 50 }),
    enabled: USE_SB && historyTab === "runs",
    staleTime: 15_000,
  });

  const { data: runRows = [], isPending: runRowsPending } = useQuery({
    queryKey: ["editHistory", "batchRun", expandedRunId],
    queryFn: () => fetchEditHistory({ batch_run_id: expandedRunId, limit: 500, only_mine: false }),
    enabled: USE_SB && historyTab === "runs" && Boolean(expandedRunId),
    staleTime: 10_000,
  });
  const cardIdsForThumbs = useMemo(() => {
    const set = new Set();
    for (const r of rows) {
      if (r?.card_id) set.add(String(r.card_id));
    }
    for (const r of runRows) {
      if (r?.card_id) set.add(String(r.card_id));
    }
    return [...set];
  }, [rows, runRows]);
  const { data: thumbnailsById = {} } = useQuery({
    queryKey: ["historyCardThumbs", cardIdsForThumbs],
    queryFn: () => fetchCardThumbnailsByIds(cardIdsForThumbs),
    enabled: USE_SB && cardIdsForThumbs.length > 0,
    staleTime: 60_000,
  });

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
      ) : null}

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-4">
        {experimentalNav ? (
          <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">Edit history</h1>
            <p className="text-gray-600 text-xs mt-0.5">Annotation field changes (newest first)</p>
          </div>
        ) : null}
        {!USE_SB && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Edit history uses Supabase. Set <code className="font-mono">VITE_USE_SUPABASE=true</code> and your
            Supabase env vars, then sign in.
          </div>
        )}

        {USE_SB && (
          <>
            <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-3">
              <button
                type="button"
                onClick={() => {
                  setHistoryTab("flat");
                  setExpandedRunId(null);
                }}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                  historyTab === "flat"
                    ? "bg-green-600 text-white"
                    : "bg-gray-100 text-gray-800 hover:bg-gray-200"
                }`}
              >
                Flat list
              </button>
              <button
                type="button"
                onClick={() => {
                  setHistoryTab("runs");
                  setExpandedRunId(null);
                }}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                  historyTab === "runs"
                    ? "bg-green-600 text-white"
                    : "bg-gray-100 text-gray-800 hover:bg-gray-200"
                }`}
              >
                Batch runs
              </button>
            </div>

            {historyTab === "runs" && (
              <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-x-auto">
                {runsPending ? (
                  <p className="p-4 text-sm text-gray-500">Loading batch runs…</p>
                ) : batchRuns.length === 0 ? (
                  <p className="p-4 text-sm text-gray-600">
                    No batch runs yet. Runs are recorded when you apply from{" "}
                    <Link to="/batch" className="text-green-700 font-medium hover:underline">
                      Batch edit
                    </Link>{" "}
                    (after migration <code className="font-mono text-xs">025</code>).
                  </p>
                ) : (
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 text-left text-xs text-gray-500 uppercase">
                        <th className="px-3 py-2 font-medium whitespace-nowrap">When</th>
                        <th className="px-3 py-2 font-medium">Fields</th>
                        <th className="px-3 py-2 font-medium tabular-nums">Cards</th>
                        <th className="px-3 py-2 font-medium">Run id</th>
                        <th className="px-3 py-2 font-medium" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {batchRuns.map((br) => (
                        <tr key={br.id} className="align-top bg-white">
                          <td className="px-3 py-2 text-gray-600 whitespace-nowrap tabular-nums text-xs">
                            {br.created_at
                              ? new Date(br.created_at).toLocaleString(undefined, {
                                  dateStyle: "short",
                                  timeStyle: "short",
                                })
                              : "—"}
                          </td>
                          <td className="px-3 py-2 text-gray-800 text-xs max-w-[240px] break-words font-mono">
                            {previewText(br.field_name, 120)}
                          </td>
                          <td className="px-3 py-2 tabular-nums text-gray-800">{br.card_count}</td>
                          <td className="px-3 py-2 font-mono text-[11px] text-gray-600 break-all">{previewText(br.id, 36)}</td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => setExpandedRunId((x) => (x === br.id ? null : br.id))}
                              className="text-green-700 text-xs font-medium hover:underline"
                            >
                              {expandedRunId === br.id ? "Hide rows" : "View rows"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {expandedRunId && (
                  <div className="border-t border-gray-100 p-3 bg-gray-50/80">
                    {runRowsPending ? (
                      <p className="text-xs text-gray-500">Loading rows…</p>
                    ) : (
                      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                        <table className="min-w-full text-xs">
                          <thead>
                            <tr className="border-b border-gray-100 text-left text-gray-500 uppercase">
                              <th className="px-2 py-1.5 font-medium">When</th>
                              <th className="px-2 py-1.5 font-medium">Thumb</th>
                              <th className="px-2 py-1.5 font-medium">Card</th>
                              <th className="px-2 py-1.5 font-medium">Field</th>
                              <th className="px-2 py-1.5 font-medium">New</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {runRows.map((r) => (
                              <tr key={`${String(r.id)}-${r.edited_at}`}>
                                <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap">
                                  {r.edited_at
                                    ? new Date(r.edited_at).toLocaleString(undefined, {
                                        dateStyle: "short",
                                        timeStyle: "short",
                                      })
                                    : "—"}
                                </td>
                                <td className="px-2 py-1.5">
                                  {cardThumb(thumbnailsById[r.card_id]) ? (
                                    <img
                                      src={cardThumb(thumbnailsById[r.card_id])}
                                      alt={r.card_id}
                                      className="w-7 h-10 rounded border border-gray-200 object-cover bg-white"
                                      loading="lazy"
                                      referrerPolicy="no-referrer"
                                    />
                                  ) : (
                                    <div className="w-7 h-10 rounded border border-gray-200 bg-gray-100" />
                                  )}
                                </td>
                                <td className="px-2 py-1.5">
                                  <Link
                                    to={`/?card=${encodeURIComponent(r.card_id)}`}
                                    className="text-green-700 font-mono hover:underline break-all"
                                  >
                                    {previewText(r.card_id, 28)}
                                  </Link>
                                </td>
                                <td className="px-2 py-1.5 font-mono">{r.field_name}</td>
                                <td className="px-2 py-1.5 text-gray-800 max-w-[160px] break-words">{previewText(r.new_value)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    <p className="text-[11px] text-gray-500 mt-2">
                      <Link
                        to={`/history?run=${encodeURIComponent(expandedRunId)}`}
                        className="text-green-700 font-medium hover:underline"
                      >
                        Open this run in flat list
                      </Link>{" "}
                      (URL filter).
                    </p>
                  </div>
                )}
              </div>
            )}

            {historyTab === "flat" && (
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[180px]">
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                  Card ID
                </label>
                <input
                  type="text"
                  value={cardFilter}
                  onChange={(e) => setQueryParam("card", e.target.value)}
                  placeholder="Optional — one card"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div className="flex-1 min-w-[160px]">
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                  Field
                </label>
                <input
                  type="text"
                  value={fieldFilter}
                  onChange={(e) => setQueryParam("field", e.target.value)}
                  placeholder="Optional — annotation field key"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
                />
              </div>
              <div className="flex-1 min-w-[200px]">
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                  Edited on or after
                </label>
                <input
                  type="text"
                  value={sinceFilter}
                  onChange={(e) => setQueryParam("since", e.target.value)}
                  placeholder="ISO time (e.g. from Batch link)"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs font-mono"
                />
              </div>
              <div className="flex-1 min-w-[220px]">
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                  Batch run id
                </label>
                <input
                  type="text"
                  value={runFilter}
                  onChange={(e) => setQueryParam("run", e.target.value)}
                  placeholder="UUID from Batch runs tab or link"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs font-mono"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none pb-2">
                <input
                  type="checkbox"
                  checked={onlyMine}
                  onChange={(e) => {
                    const next = new URLSearchParams(searchParams);
                    if (e.target.checked) next.set("mine", "1");
                    else next.delete("mine");
                    setSearchParams(next, { replace: true });
                  }}
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
              <button
                type="button"
                onClick={() => {
                  const next = new URLSearchParams(searchParams);
                  ["card", "field", "since", "run", "mine"].forEach((k) => next.delete(k));
                  setSearchParams(next, { replace: true });
                }}
                className="px-3 py-2 text-sm font-medium rounded-lg border border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100"
              >
                Clear filters
              </button>
            </div>
            )}

            {historyTab === "flat" && (
            <p className="text-xs text-gray-500">
              Filters update the URL so you can bookmark or share a view. Values are stored as text (JSON for lists/objects).
              Opens in Explore with the card drawer when you follow a card link. This list is <strong>annotation edits</strong>{" "}
              only—not custom card creation; new cards you add appear under{" "}
              <Link to="/dashboard" className="text-green-700 font-medium hover:underline">Dashboard</Link> and the add
              form’s session list.
            </p>
            )}

            {historyTab === "flat" && isPending && <p className="text-sm text-gray-500">Loading…</p>}
            {historyTab === "flat" && isError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {error?.message || "Could not load history."}
              </div>
            )}

            {historyTab === "flat" && !isPending && !isError && rows.length === 0 && (
              <p className="text-sm text-gray-600">
                No rows yet. History is recorded when you save annotations in Workbench, Card Detail, or Batch edit
                (Supabase mode).
              </p>
            )}

            {historyTab === "flat" && !isPending && !isError && rows.length > 0 && (
              <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-xs text-gray-500 uppercase">
                      <th className="px-3 py-2 font-medium whitespace-nowrap">When</th>
                      <th className="px-3 py-2 font-medium">Editor</th>
                      <th className="px-3 py-2 font-medium">Thumb</th>
                      <th className="px-3 py-2 font-medium">Card</th>
                      <th className="px-3 py-2 font-medium">Field</th>
                      <th className="px-3 py-2 font-medium">Batch run</th>
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
                          {r.edited_by ? (
                            <Link
                              to={`/profile/${encodeURIComponent(r.edited_by)}`}
                              className="text-green-700 hover:underline break-words"
                            >
                              {r.editor_display_name?.trim()
                                ? r.editor_display_name
                                : previewText(r.edited_by, 12)}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {cardThumb(thumbnailsById[r.card_id]) ? (
                            <img
                              src={cardThumb(thumbnailsById[r.card_id])}
                              alt={r.card_id}
                              className="w-7 h-10 rounded border border-gray-200 object-cover bg-white"
                              loading="lazy"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div className="w-7 h-10 rounded border border-gray-200 bg-gray-100" />
                          )}
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
                        <td className="px-3 py-2 font-mono text-[10px] text-gray-600 max-w-[100px] break-all">
                          {r.batch_run_id ? (
                            <Link
                              to={`/history?run=${encodeURIComponent(r.batch_run_id)}`}
                              className="text-green-700 hover:underline"
                              title={r.batch_run_id}
                            >
                              {previewText(r.batch_run_id, 14)}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </td>
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
