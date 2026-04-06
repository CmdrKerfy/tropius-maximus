/**
 * Batch annotation edit — same filter set as Explore (query string), one field at a time.
 */

import { useMemo, useState } from "react";
import { NavLink, Link, useLocation } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DEFAULT_FILTERS,
  readUrlStateFromSearch,
} from "../lib/exploreUrlState.js";
import {
  fetchCards,
  fetchAttributes,
  fetchMatchingCardIds,
  batchPatchAnnotations,
} from "../db";

const USE_SB =
  import.meta.env.VITE_USE_SUPABASE === "true" &&
  Boolean(import.meta.env.VITE_SUPABASE_URL) &&
  Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY);

const navLinkClass = ({ isActive }) =>
  `px-3 py-1.5 rounded text-sm font-medium transition-colors ${
    isActive ? "bg-white text-green-700" : "bg-green-700 hover:bg-green-800 text-white"
  }`;

function parseMultiValue(raw) {
  if (raw == null || String(raw).trim() === "") return [];
  return String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildPatch(attr, mode, textValue, boolValue) {
  const key = attr.key;
  if (mode === "clear") return { [key]: null };

  switch (attr.value_type) {
    case "boolean":
      return { [key]: boolValue };
    case "number": {
      const t = String(textValue ?? "").trim();
      if (t === "") return { [key]: null };
      const n = Number(t);
      if (Number.isNaN(n)) throw new Error("Enter a valid number or clear the field.");
      return { [key]: n };
    }
    case "multi_select":
      return { [key]: parseMultiValue(textValue) };
    case "select":
    case "text":
    case "url":
    default: {
      const t = String(textValue ?? "").trim();
      return { [key]: t === "" ? null : t };
    }
  }
}

export default function BatchEditPage() {
  const location = useLocation();
  const queryClient = useQueryClient();
  const parsed = useMemo(() => readUrlStateFromSearch(location.search), [location.search]);
  const filters = useMemo(() => ({ ...DEFAULT_FILTERS, ...parsed.urlFilters }), [parsed.urlFilters]);
  const q = parsed.searchQuery !== null ? parsed.searchQuery : "";

  const fetchParams = useMemo(
    () => ({
      q,
      ...filters,
      page: 1,
      page_size: 1,
    }),
    [q, filters]
  );

  const previewParams = useMemo(
    () => ({
      q,
      ...filters,
      page: 1,
      page_size: 12,
    }),
    [q, filters]
  );

  const { data: countResult, isPending: countPending } = useQuery({
    queryKey: ["batchCardCount", location.search],
    queryFn: () => fetchCards(fetchParams),
    enabled: USE_SB,
  });

  const { data: attributes = [], isPending: attrPending } = useQuery({
    queryKey: ["attributes"],
    queryFn: fetchAttributes,
    enabled: USE_SB,
  });

  const total = countResult?.total ?? 0;

  const { data: previewResult, isPending: previewPending } = useQuery({
    queryKey: ["batchPreview", location.search],
    queryFn: () => fetchCards(previewParams),
    enabled: USE_SB && total > 0,
  });

  const [fieldKey, setFieldKey] = useState("");
  const [mode, setMode] = useState("set");
  const [textValue, setTextValue] = useState("");
  const [boolValue, setBoolValue] = useState(false);
  const [confirmLarge, setConfirmLarge] = useState(false);
  const [batchProgress, setBatchProgress] = useState(null);

  const selectedAttr = useMemo(
    () => attributes.find((a) => a.key === fieldKey) || null,
    [attributes, fieldKey]
  );

  const LARGE_THRESHOLD = 75;
  const needsConfirm = total > LARGE_THRESHOLD;

  const runBatch = useMutation({
    mutationFn: async () => {
      if (!selectedAttr) throw new Error("Choose a field.");
      if (total === 0) throw new Error("No cards match these filters.");
      if (needsConfirm && !confirmLarge) throw new Error("Confirm the large update below.");

      const patch = buildPatch(selectedAttr, mode, textValue, boolValue);
      const listParams = { q, ...filters };
      const ids = await fetchMatchingCardIds(listParams);
      setBatchProgress({ done: 0, total: ids.length });
      return batchPatchAnnotations(ids, patch, {
        onProgress: (done, tot) => setBatchProgress({ done, total: tot }),
      });
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["cards"] });
      queryClient.invalidateQueries({ queryKey: ["filterOptions"] });
      queryClient.invalidateQueries({ queryKey: ["batchCardCount"] });
      queryClient.invalidateQueries({ queryKey: ["batchPreview"] });
      queryClient.invalidateQueries({ queryKey: ["formOptions"] });
      queryClient.invalidateQueries({ queryKey: ["editHistory"] });
      if (result.errors.length === 0) setConfirmLarge(false);
    },
    onSettled: () => setBatchProgress(null),
  });

  const sortedAttrs = useMemo(
    () => [...attributes].sort((a, b) => (a.label || a.key).localeCompare(b.label || b.key)),
    [attributes]
  );

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
              <h1 className="text-xl font-bold tracking-tight">Batch edit</h1>
              <p className="text-green-100 text-xs">Apply one annotation field using your current Explore filters</p>
            </div>
          </div>
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
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        {!USE_SB && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Batch edit uses Supabase. Set <code className="font-mono">VITE_USE_SUPABASE=true</code> and your Supabase
            env vars, then sign in.
          </div>
        )}

        {USE_SB && (
          <>
            <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-4 space-y-2 text-sm">
              <p className="text-gray-700">
                Filters come from the URL (same as Explore).{" "}
                <Link to={{ pathname: "/", search: location.search }} className="text-green-700 font-medium underline">
                  Adjust on Explore
                </Link>{" "}
                and use the <span className="font-medium">Batch</span> tab to return here.
              </p>
              <p className="text-gray-600">
                Matching cards:{" "}
                {countPending ? (
                  <span className="text-gray-400">…</span>
                ) : (
                  <span className="font-semibold tabular-nums text-gray-900">{total.toLocaleString()}</span>
                )}
              </p>
              {total > 0 && needsConfirm && (
                <label className="flex items-start gap-2 mt-2 text-amber-900">
                  <input
                    type="checkbox"
                    className="mt-1 rounded"
                    checked={confirmLarge}
                    onChange={(e) => setConfirmLarge(e.target.checked)}
                  />
                  <span>
                    This will update more than {LARGE_THRESHOLD} cards. I have narrowed filters intentionally.
                  </span>
                </label>
              )}

              {total > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    Preview
                    {!previewPending && previewResult?.cards
                      ? ` (${previewResult.cards.length.toLocaleString()} of ${total.toLocaleString()} shown)`
                      : ""}
                  </p>
                  {previewPending ? (
                    <p className="text-xs text-gray-400">Loading sample…</p>
                  ) : (
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {(previewResult?.cards || []).map((c) => (
                        <Link
                          key={c.id}
                          to={`/?card=${encodeURIComponent(c.id)}`}
                          className="shrink-0 w-[72px] text-center hover:opacity-90"
                        >
                          <img
                            src={c.image_small || c.image_large || ""}
                            alt=""
                            className="h-[88px] w-full object-contain rounded border border-gray-200 bg-white"
                          />
                          <span className="block mt-1 text-[10px] text-gray-600 line-clamp-2 leading-tight">
                            {c.name || c.id}
                          </span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Field</label>
                {attrPending ? (
                  <p className="text-sm text-gray-500">Loading fields…</p>
                ) : (
                  <select
                    value={fieldKey}
                    onChange={(e) => {
                      setFieldKey(e.target.value);
                      setTextValue("");
                      setBoolValue(false);
                    }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                  >
                    <option value="">Select a field…</option>
                    {sortedAttrs.map((a) => (
                      <option key={a.key} value={a.key}>
                        {a.label || a.key}
                        {a.is_builtin ? "" : " (custom)"}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {selectedAttr && (
                <>
                  <div className="flex flex-wrap gap-4 text-sm">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="batchMode"
                        checked={mode === "set"}
                        onChange={() => setMode("set")}
                      />
                      Set value
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="batchMode"
                        checked={mode === "clear"}
                        onChange={() => setMode("clear")}
                      />
                      Clear field (remove value)
                    </label>
                  </div>

                  {mode === "set" && selectedAttr.value_type === "boolean" && (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="rounded"
                        checked={boolValue}
                        onChange={(e) => setBoolValue(e.target.checked)}
                      />
                      Checked = true, unchecked = false
                    </label>
                  )}

                  {mode === "set" &&
                    selectedAttr.value_type === "select" &&
                    Array.isArray(selectedAttr.options) &&
                    selectedAttr.options.length > 0 && (
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                        Value
                      </label>
                      <select
                        value={textValue}
                        onChange={(e) => setTextValue(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                      >
                        <option value="">—</option>
                        {selectedAttr.options.map((opt) => (
                          <option key={String(opt)} value={String(opt)}>
                            {String(opt)}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {mode === "set" &&
                    selectedAttr.value_type !== "boolean" &&
                    !(
                      selectedAttr.value_type === "select" &&
                      Array.isArray(selectedAttr.options) &&
                      selectedAttr.options.length > 0
                    ) && (
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                          {selectedAttr.value_type === "multi_select"
                            ? "Values (comma-separated)"
                            : "Value"}
                        </label>
                        {selectedAttr.value_type === "number" ? (
                          <input
                            type="text"
                            inputMode="decimal"
                            value={textValue}
                            onChange={(e) => setTextValue(e.target.value)}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                            placeholder="Number"
                          />
                        ) : (
                          <textarea
                            value={textValue}
                            onChange={(e) => setTextValue(e.target.value)}
                            rows={selectedAttr.value_type === "multi_select" ? 3 : 2}
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
                            placeholder={
                              selectedAttr.value_type === "multi_select"
                                ? "e.g. Sunny, Clouds"
                                : "New value for every matching card"
                            }
                          />
                        )}
                      </div>
                    )}
                </>
              )}

              <button
                type="button"
                disabled={
                  runBatch.isPending ||
                  !selectedAttr ||
                  total === 0 ||
                  (needsConfirm && !confirmLarge) ||
                  countPending
                }
                onClick={() => runBatch.mutate()}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-green-600 hover:bg-green-700
                  disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {runBatch.isPending ? "Updating…" : "Apply to all matching cards"}
              </button>

              {batchProgress && batchProgress.total > 0 && (
                <div className="space-y-1">
                  <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
                    <div
                      className="h-full bg-green-600 transition-[width] duration-150"
                      style={{
                        width: `${Math.min(100, (100 * batchProgress.done) / batchProgress.total)}%`,
                      }}
                    />
                  </div>
                  <p className="text-xs text-gray-500 tabular-nums">
                    {batchProgress.done.toLocaleString()} / {batchProgress.total.toLocaleString()} cards processed
                  </p>
                </div>
              )}

              {runBatch.isError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  {runBatch.error?.message || "Batch update failed."}
                </div>
              )}

              {runBatch.isSuccess && runBatch.data && (
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800 space-y-1">
                  <p>
                    Updated <span className="font-semibold tabular-nums">{runBatch.data.updated}</span> card
                    {runBatch.data.updated !== 1 ? "s" : ""}.
                  </p>
                  {runBatch.data.errors.length > 0 && (
                    <details className="text-amber-900">
                      <summary className="cursor-pointer font-medium">
                        {runBatch.data.errors.length} error{runBatch.data.errors.length !== 1 ? "s" : ""} (show list)
                      </summary>
                      <ul className="mt-2 max-h-40 overflow-y-auto font-mono text-xs space-y-1">
                        {runBatch.data.errors.map((e) => (
                          <li key={e.cardId}>
                            {e.cardId}: {e.message}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
