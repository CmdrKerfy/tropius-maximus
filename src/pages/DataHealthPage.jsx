/**
 * Data Health — Phase 6: read-only Supabase snapshot (counts).
 */

import { NavLink } from "react-router-dom";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  applyAnnotationValueCleanup,
  fetchAnnotationValueIssues,
  fetchCardsForAnnotationValueIssue,
  fetchDataHealthSummary,
  FORM_OPTIONS_QUERY_KEY,
} from "../db";
import AuthUserMenu from "../components/AuthUserMenu.jsx";
import { useExperimentalAppNav } from "../lib/navEnv.js";
import { toastError, toastSuccess } from "../lib/toast.js";

const USE_SB =
  import.meta.env.VITE_USE_SUPABASE === "true" &&
  Boolean(import.meta.env.VITE_SUPABASE_URL) &&
  Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY);

const navLinkClass = ({ isActive }) =>
  `px-3 py-1.5 rounded text-sm font-medium transition-colors ${
    isActive ? "bg-white text-green-700" : "bg-green-700 hover:bg-green-800 text-white"
  }`;

const ORIGIN_LABELS = {
  "pokemontcg.io": "Pokémon TCG API",
  tcgdex: "Pocket (TCGdex)",
  manual: "Manual / custom",
};

const MANUAL_ID_ISSUE_LABELS = {
  missing_set_id: "Missing set_id",
  missing_number: "Missing number",
  legacy_prefix: "Legacy prefix",
  non_canonical: "Non-canonical ID",
};

const FIELD_LABELS = {
  background_pokemon: "Background Pokémon",
  background_humans: "Background People Type",
  additional_characters: "Background People Name",
  background_details: "Background Details",
  emotion: "Emotion",
  pose: "Pose",
  actions: "Actions",
  items: "Items",
  held_item: "Held Item",
  pokeball: "Pokéball Type",
  evolution_items: "Evolution Items",
  berries: "Berries",
  card_subcategory: "Card Subcategory",
  trainer_card_subgroup: "Trainer Card Subgroup",
  holiday_theme: "Holiday Theme",
  multi_card: "Multi Card",
  video_type: "Video Type",
  video_region: "Video Region",
  video_location: "Video Location",
};

const ISSUE_FILTER_MAP = {
  background_pokemon: "background_pokemon",
  pose: "pose",
  actions: "actions",
};

const ISSUE_CARDS_VISIBLE_PAGE = 120;

const MISSING_RPC_MIGRATION = {
  get_manual_card_id_health_issues: "027_manual_card_id_health_check.sql",
  get_annotation_value_issues: "028_annotation_value_issues_and_cleanup_rpc.sql",
  get_cards_for_annotation_value_issue: "028_annotation_value_issues_and_cleanup_rpc.sql",
  apply_annotation_value_cleanup: "028_annotation_value_issues_and_cleanup_rpc.sql",
};

function missingRpcFromError(err) {
  const msg = String(err?.message || "");
  const m =
    msg.match(/Could not find the function public\.([a-zA-Z0-9_]+)\s*\(/i) ||
    msg.match(/function public\.([a-zA-Z0-9_]+)/i);
  if (!m?.[1]) return null;
  const fn = m[1];
  return {
    functionName: fn,
    migration: MISSING_RPC_MIGRATION[fn] || null,
  };
}

function issueExploreHref(issue) {
  const value = String(issue?.field_value || "").trim();
  if (!value) return "/";
  const p = new URLSearchParams();
  const mapped = ISSUE_FILTER_MAP[issue?.field_key] || "q";
  if (mapped === "q") p.set("q", value);
  else p.append(mapped, value);
  return `/?${p.toString()}`;
}

export default function DataHealthPage() {
  const queryClient = useQueryClient();
  const experimentalNav = useExperimentalAppNav();
  const valueIssuesDetailsRef = useRef(null);
  const [selectedIssue, setSelectedIssue] = useState(null); // { field_key, field_value }
  const [visibleIssueCards, setVisibleIssueCards] = useState(ISSUE_CARDS_VISIBLE_PAGE);
  const [cleanupMode, setCleanupMode] = useState("replace");
  const [replacementValue, setReplacementValue] = useState("");
  const [cleanupConfirmed, setCleanupConfirmed] = useState(false);
  const [lastCleanup, setLastCleanup] = useState(null);
  const [hoverPreview, setHoverPreview] = useState(null); // { src, name, x, y }
  const [hoverPreviewLoaded, setHoverPreviewLoaded] = useState(false);
  const { data, isPending, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["dataHealthSummary"],
    queryFn: fetchDataHealthSummary,
    enabled: USE_SB,
    staleTime: 60_000,
  });
  const {
    data: valueIssuesQueryData,
    isPending: valueIssuesPending,
    isError: valueIssuesError,
    error: valueIssuesErrObj,
    refetch: refetchValueIssues,
  } = useQuery({
    queryKey: ["annotationValueIssues"],
    queryFn: async () => {
      try {
        const rows = await fetchAnnotationValueIssues({ limit: 150, minCount: 2 });
        return { rows, missingRpc: null };
      } catch (e) {
        const missingRpc = missingRpcFromError(e);
        if (missingRpc) return { rows: [], missingRpc };
        throw e;
      }
    },
    enabled: USE_SB,
    staleTime: 60_000,
  });
  const valueIssues = valueIssuesQueryData?.rows || [];
  const valueIssuesMissingRpc = valueIssuesQueryData?.missingRpc || null;
  const {
    data: issueCardsQueryData,
    isPending: issueCardsPending,
    isError: issueCardsError,
    error: issueCardsErrObj,
  } = useQuery({
    queryKey: ["annotationValueIssueCards", selectedIssue?.field_key || "", selectedIssue?.field_value || ""],
    queryFn: async () => {
      try {
        const rows = await fetchCardsForAnnotationValueIssue({
          fieldKey: selectedIssue?.field_key,
          value: selectedIssue?.field_value,
          limit: 400,
        });
        return { rows, missingRpc: null };
      } catch (e) {
        const missingRpc = missingRpcFromError(e);
        if (missingRpc) return { rows: [], missingRpc };
        throw e;
      }
    },
    enabled: USE_SB && Boolean(selectedIssue?.field_key && selectedIssue?.field_value),
    staleTime: 30_000,
  });
  const issueCards = issueCardsQueryData?.rows || [];
  const issueCardsMissingRpc = issueCardsQueryData?.missingRpc || null;
  const visibleCards = issueCards.slice(0, visibleIssueCards);
  const canLoadMoreIssueCards = issueCards.length > visibleCards.length;
  const cleanupMutation = useMutation({
    mutationFn: ({ fieldKey, oldValue, newValue, mode }) =>
      applyAnnotationValueCleanup({ fieldKey, oldValue, newValue, mode }),
    onSuccess: ({ updatedRows }) => {
      const oldValue = selectedIssue?.field_value || "";
      const fieldKey = selectedIssue?.field_key || "";
      const newValue = cleanupMode === "replace" ? String(replacementValue || "").trim() : null;
      toastSuccess(
        cleanupMode === "remove"
          ? `Removed value from ${updatedRows.toLocaleString()} annotation row(s).`
          : `Replaced value in ${updatedRows.toLocaleString()} annotation row(s).`
      );
      setLastCleanup({
        at: new Date().toISOString(),
        fieldKey,
        oldValue,
        newValue,
        mode: cleanupMode,
        updatedRows,
      });
      setCleanupConfirmed(false);
      setReplacementValue("");
      queryClient.invalidateQueries({ queryKey: ["annotationValueIssues"] });
      queryClient.invalidateQueries({ queryKey: ["annotationValueIssueCards"] });
      queryClient.invalidateQueries({ queryKey: ["cards"] });
      queryClient.invalidateQueries({ queryKey: ["filterOptions"] });
      queryClient.invalidateQueries({ queryKey: FORM_OPTIONS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["dataHealthSummary"] });
    },
    onError: (e) => toastError(e),
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
                <h1 className="text-xl font-bold tracking-tight">Data Health</h1>
                <p className="text-green-100 text-xs">Counts from your Supabase project</p>
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

      <main className="max-w-3xl mx-auto px-4 py-8">
        {experimentalNav ? (
          <div className="mb-6 rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">Data Health</h1>
            <p className="text-gray-600 text-xs mt-0.5">Counts from your Supabase project</p>
          </div>
        ) : null}
        {!USE_SB && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Data Health uses Supabase. Set <code className="font-mono">VITE_USE_SUPABASE=true</code> and your
            Supabase env vars, then sign in.
          </div>
        )}

        {USE_SB && (
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => refetch()}
                disabled={isFetching}
                className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 bg-white
                  hover:bg-gray-50 disabled:opacity-50"
              >
                {isFetching ? "Refreshing…" : "Refresh"}
              </button>
            </div>

            {isPending && <p className="text-sm text-gray-500">Loading counts…</p>}
            {isError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {error?.message || "Could not load summary."}
              </div>
            )}

            {data && data.totalCards != null && (
              <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Overview
                </div>
                <dl className="divide-y divide-gray-100">
                  <div className="px-4 py-3 flex justify-between gap-4">
                    <dt className="text-sm text-gray-600">Cards</dt>
                    <dd className="text-sm font-medium tabular-nums">{data.totalCards.toLocaleString()}</dd>
                  </div>
                  <div className="px-4 py-3 flex justify-between gap-4">
                    <dt className="text-sm text-gray-600">Annotation rows</dt>
                    <dd className="text-sm font-medium tabular-nums">{data.annotationRows.toLocaleString()}</dd>
                  </div>
                  <div className="px-4 py-3 flex justify-between gap-4">
                    <dt className="text-sm text-gray-600">Cards without an annotations row</dt>
                    <dd className="text-sm font-medium tabular-nums text-amber-800">
                      {data.cardsWithoutAnnotationRow.toLocaleString()}
                    </dd>
                  </div>
                  <div className="px-4 py-3 flex justify-between gap-4">
                    <dt className="text-sm text-gray-600">Sets</dt>
                    <dd className="text-sm font-medium tabular-nums">{data.sets.toLocaleString()}</dd>
                  </div>
                  <div className="px-4 py-3 flex justify-between gap-4">
                    <dt className="text-sm text-gray-600">Field definitions (all)</dt>
                    <dd className="text-sm font-medium tabular-nums">{data.fieldDefinitions.toLocaleString()}</dd>
                  </div>
                  <div className="px-4 py-3 flex justify-between gap-4">
                    <dt className="text-sm text-gray-600">Custom field definitions</dt>
                    <dd className="text-sm font-medium tabular-nums">
                      {(data.customFieldDefinitions ?? 0).toLocaleString()}
                    </dd>
                  </div>
                  <div className="px-4 py-3 flex justify-between gap-4">
                    <dt className="text-sm text-gray-600">Normalization rules</dt>
                    <dd className="text-sm font-medium tabular-nums">
                      {(data.normalizationRules ?? 0).toLocaleString()}
                    </dd>
                  </div>
                  <div className="px-4 py-3 flex justify-between gap-4">
                    <dt className="text-sm text-gray-600">Your workbench queues</dt>
                    <dd className="text-sm font-medium tabular-nums">
                      {(data.workbenchQueues ?? 0).toLocaleString()}
                    </dd>
                  </div>
                  <div className="px-4 py-3 flex justify-between gap-4">
                    <dt className="text-sm text-gray-600">Pokémon metadata rows</dt>
                    <dd className="text-sm font-medium tabular-nums">{data.pokemonMetadataRows.toLocaleString()}</dd>
                  </div>
                </dl>
              </div>
            )}

            {data?.cardsByOrigin && (
              <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Cards by origin
                </div>
                <dl className="divide-y divide-gray-100">
                  {Object.entries(data.cardsByOrigin).map(([origin, n]) => (
                    <div key={origin} className="px-4 py-3 flex justify-between gap-4">
                      <dt className="text-sm text-gray-600">{ORIGIN_LABELS[origin] || origin}</dt>
                      <dd className="text-sm font-medium tabular-nums">{(n ?? 0).toLocaleString()}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            {data?.missingHealthRpcs?.includes("get_manual_card_id_health_issues") && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Manual card ID health is unavailable on this project because RPC{" "}
                <code className="font-mono">get_manual_card_id_health_issues</code> is missing. Apply{" "}
                <code className="font-mono">supabase/migrations/027_manual_card_id_health_check.sql</code>, then
                refresh.
              </div>
            )}

            {data?.manualCardIdHealth && (
              <details
                className={`rounded-xl border shadow-sm overflow-hidden ${
                  data.manualCardIdHealth.totalIssues > 0
                    ? "border-amber-200 bg-amber-50/60"
                    : "border-emerald-200 bg-emerald-50/60"
                }`}
              >
                <summary className="px-4 py-3 cursor-pointer text-xs font-semibold text-gray-500 uppercase tracking-wide select-none">
                  Manual card ID health
                </summary>
                <div className="border-t border-gray-100">
                  <div className="px-4 py-3 text-sm">
                    {data.manualCardIdHealth.totalIssues > 0 ? (
                      <p className="text-amber-900">
                        Found{" "}
                        <strong className="font-semibold tabular-nums">
                          {data.manualCardIdHealth.totalIssues.toLocaleString()}
                        </strong>{" "}
                        manual card ID issue(s). These rows still work, but they do not match the canonical{" "}
                        <code className="font-mono"> custom-{"{set_id}"}-{"{number}"}</code> pattern.
                      </p>
                    ) : (
                      <p className="text-emerald-900">No manual card ID issues detected.</p>
                    )}
                  </div>
                  {data.manualCardIdHealth.sample?.length > 0 && (
                    <div className="overflow-x-auto border-t border-gray-100">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-100 text-left text-xs text-gray-500 uppercase">
                            <th className="px-4 py-2 font-medium">Issue</th>
                            <th className="px-4 py-2 font-medium">Current ID</th>
                            <th className="px-4 py-2 font-medium">Expected ID</th>
                            <th className="px-4 py-2 font-medium">Set / #</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {data.manualCardIdHealth.sample.map((row) => (
                            <tr key={`${row.id}-${row.issue}`} className="align-top">
                              <td className="px-4 py-2 text-gray-700">
                                {MANUAL_ID_ISSUE_LABELS[row.issue] || row.issue || "Issue"}
                              </td>
                              <td className="px-4 py-2 font-mono text-xs text-gray-800">{row.id}</td>
                              <td className="px-4 py-2 font-mono text-xs text-gray-600">{row.expected_id}</td>
                              <td className="px-4 py-2 text-gray-700">
                                {row.set_id || "—"} / {row.number || "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </details>
            )}

            <details
              ref={valueIssuesDetailsRef}
              className="rounded-xl border border-slate-300 bg-slate-50/70 shadow-sm overflow-hidden"
            >
              <summary className="px-4 py-3 cursor-pointer text-xs font-semibold text-slate-700 uppercase tracking-wide select-none">
                Annotation value issues
              </summary>
              <div className="border-t border-gray-100">
                <div className="px-4 py-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => refetchValueIssues()}
                    className="text-[11px] px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50 normal-case text-gray-700"
                  >
                    Refresh
                  </button>
                </div>
                {valueIssuesPending ? (
                  <p className="px-4 py-4 text-sm text-gray-500">Loading value issues…</p>
                ) : valueIssuesMissingRpc ? (
                  <p className="px-4 py-4 text-sm text-amber-800">
                    Annotation value issues are unavailable because RPC{" "}
                    <code className="font-mono">{valueIssuesMissingRpc.functionName}</code> is missing. Apply{" "}
                    <code className="font-mono">
                      supabase/migrations/{valueIssuesMissingRpc.migration || "028_annotation_value_issues_and_cleanup_rpc.sql"}
                    </code>
                    , then refresh.
                  </p>
                ) : valueIssuesError ? (
                  <p className="px-4 py-4 text-sm text-red-700">
                    {valueIssuesErrObj?.message || "Could not load value issues."}
                  </p>
                ) : valueIssues.length === 0 ? (
                  <p className="px-4 py-4 text-sm text-emerald-700">No repeated annotation values flagged.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100 text-left text-xs text-gray-500 uppercase">
                          <th className="px-4 py-2 font-medium">Field</th>
                          <th className="px-4 py-2 font-medium">Value</th>
                          <th className="px-4 py-2 font-medium">Cards</th>
                          <th className="px-4 py-2 font-medium">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {valueIssues.map((issue) => {
                          const selected =
                            selectedIssue?.field_key === issue.field_key &&
                            selectedIssue?.field_value === issue.field_value;
                          return (
                            <tr
                              key={`${issue.field_key}:${issue.field_value}`}
                              className={selected ? "bg-green-50/40" : undefined}
                            >
                              <td className="px-4 py-2 text-gray-700">
                                {FIELD_LABELS[issue.field_key] || issue.field_key}
                              </td>
                              <td className="px-4 py-2 font-mono text-xs text-gray-800">{issue.field_value}</td>
                              <td className="px-4 py-2 tabular-nums text-gray-700">
                                {issue.card_count.toLocaleString()}
                              </td>
                              <td className="px-4 py-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedIssue({
                                        field_key: issue.field_key,
                                        field_value: issue.field_value,
                                      });
                                      setVisibleIssueCards(ISSUE_CARDS_VISIBLE_PAGE);
                                      setCleanupMode("replace");
                                      setReplacementValue("");
                                      setCleanupConfirmed(false);
                                      if (valueIssuesDetailsRef.current) {
                                        valueIssuesDetailsRef.current.open = false;
                                      }
                                    }}
                                    className="px-2 py-1 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50"
                                  >
                                    View cards
                                  </button>
                                  <a
                                    href={issueExploreHref(issue)}
                                    className="px-2 py-1 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50"
                                  >
                                    Open in Explore
                                  </a>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </details>

            {selectedIssue && (
              <div className="rounded-xl border border-slate-300 bg-slate-50/40 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span>
                      Cards using value:{" "}
                      <span className="normal-case text-gray-700">
                        {FIELD_LABELS[selectedIssue.field_key] || selectedIssue.field_key} ={" "}
                        <code className="font-mono">{selectedIssue.field_value}</code>
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const href = issueExploreHref(selectedIssue);
                          const absoluteHref = `${window.location.origin}${href}`;
                          await navigator.clipboard.writeText(absoluteHref);
                          toastSuccess("Copied Explore deep link.");
                        } catch (e) {
                          toastError(e);
                        }
                      }}
                      className="text-[11px] px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 normal-case text-slate-700"
                    >
                      Copy deep link
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedIssue(null);
                      setCleanupConfirmed(false);
                      setReplacementValue("");
                      setCleanupMode("replace");
                    }}
                    className="text-[11px] px-2 py-1 rounded border border-red-300 bg-red-50 hover:bg-red-100 normal-case text-red-700"
                  >
                    Clear selection
                  </button>
                </div>

                <div className="px-4 py-3 border-b border-slate-200 bg-slate-100/60">
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
                    <div className="md:col-span-1">
                      <label className="block text-xs font-medium text-gray-600 mb-1">Mode</label>
                      <select
                        value={cleanupMode}
                        onChange={(e) => setCleanupMode(e.target.value)}
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
                      >
                        <option value="replace">Replace value</option>
                        <option value="remove">Remove value</option>
                      </select>
                      <p className="mt-1 text-[11px] text-gray-500 normal-case">
                        Replace swaps one value everywhere; remove deletes that value from matching arrays.
                      </p>
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        {cleanupMode === "replace" ? "New value" : "Current value"}
                      </label>
                      {cleanupMode === "replace" ? (
                        <input
                          type="text"
                          value={replacementValue}
                          onChange={(e) => setReplacementValue(e.target.value)}
                          placeholder="e.g. pikachu"
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
                        />
                      ) : (
                        <div className="px-2 py-1.5 text-sm border border-gray-200 rounded bg-gray-100 text-gray-700 font-mono">
                          {selectedIssue.field_value}
                        </div>
                      )}
                    </div>
                    <label className="md:col-span-1 flex items-center gap-2 text-xs text-gray-700">
                      <input
                        type="checkbox"
                        checked={cleanupConfirmed}
                        onChange={(e) => setCleanupConfirmed(e.target.checked)}
                        className="rounded"
                      />
                      I understand this updates all matching cards
                    </label>
                    <div className="md:col-span-1">
                      <button
                        type="button"
                        onClick={() =>
                          cleanupMutation.mutate({
                            fieldKey: selectedIssue.field_key,
                            oldValue: selectedIssue.field_value,
                            newValue: cleanupMode === "replace" ? replacementValue : null,
                            mode: cleanupMode,
                          })
                        }
                        disabled={
                          cleanupMutation.isPending ||
                          !cleanupConfirmed ||
                          (cleanupMode === "replace" && !String(replacementValue).trim())
                        }
                        className="w-full px-3 py-1.5 text-sm font-medium rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        {cleanupMutation.isPending ? "Applying…" : "Apply cleanup"}
                      </button>
                    </div>
                  </div>
                </div>
                {lastCleanup &&
                  lastCleanup.fieldKey === selectedIssue.field_key &&
                  (lastCleanup.newValue || lastCleanup.oldValue) && (
                    <div className="px-4 py-2 border-b border-slate-200 bg-white text-xs text-slate-700 flex flex-wrap items-center gap-2">
                      <span>
                        Last cleanup this session:{" "}
                        <strong className="font-semibold">
                          {lastCleanup.mode === "remove"
                            ? `remove "${lastCleanup.oldValue}"`
                            : `replace "${lastCleanup.oldValue}" with "${lastCleanup.newValue}"`}
                        </strong>{" "}
                        on {lastCleanup.updatedRows.toLocaleString()} row(s).
                      </span>
                      {lastCleanup.mode === "replace" && lastCleanup.newValue ? (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedIssue({
                              field_key: lastCleanup.fieldKey,
                              field_value: lastCleanup.newValue,
                            });
                            setCleanupMode("replace");
                            setReplacementValue(lastCleanup.oldValue);
                            setCleanupConfirmed(false);
                            setVisibleIssueCards(ISSUE_CARDS_VISIBLE_PAGE);
                          }}
                          className="text-[11px] px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-50"
                        >
                          Prepare undo (replace back)
                        </button>
                      ) : (
                        <span className="text-[11px] text-slate-500">
                          Remove mode cannot auto-restore exact per-card order.
                        </span>
                      )}
                    </div>
                  )}

                {issueCardsPending ? (
                  <p className="px-4 py-4 text-sm text-gray-500">Loading cards…</p>
                ) : issueCardsMissingRpc ? (
                  <p className="px-4 py-4 text-sm text-amber-800">
                    Card lookup is unavailable because RPC{" "}
                    <code className="font-mono">{issueCardsMissingRpc.functionName}</code> is missing. Apply{" "}
                    <code className="font-mono">
                      supabase/migrations/{issueCardsMissingRpc.migration || "028_annotation_value_issues_and_cleanup_rpc.sql"}
                    </code>
                    , then refresh.
                  </p>
                ) : issueCardsError ? (
                  <p className="px-4 py-4 text-sm text-red-700">
                    {issueCardsErrObj?.message || "Could not load cards for this issue."}
                  </p>
                ) : issueCards.length === 0 ? (
                  <p className="px-4 py-4 text-sm text-gray-500">No cards currently match this value.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <div className="px-4 py-2 text-xs text-gray-500 border-b border-gray-100">
                      Tip: on smaller screens, scroll horizontally to view all columns.
                    </div>
                    <table className="min-w-[760px] w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100 text-left text-xs text-gray-500 uppercase">
                          <th className="px-4 py-2 font-medium">Card</th>
                          <th className="px-4 py-2 font-medium">ID</th>
                          <th className="px-4 py-2 font-medium">Name</th>
                          <th className="px-4 py-2 font-medium">Set</th>
                          <th className="px-4 py-2 font-medium">#</th>
                          <th className="px-4 py-2 font-medium">Origin</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {visibleCards.map((c) => (
                          <tr key={c.id}>
                            <td className="px-4 py-2">
                              {c.image_small ? (
                                <img
                                  src={c.image_small}
                                  alt={c.name || c.id}
                                  className="h-14 w-10 rounded object-cover border border-gray-200 bg-gray-100"
                                  loading="lazy"
                                  onMouseEnter={(e) => {
                                    setHoverPreviewLoaded(false);
                                    setHoverPreview({
                                      src: c.image_small,
                                      name: c.name || c.id,
                                      x: e.clientX + 18,
                                      y: e.clientY - 12,
                                    });
                                  }}
                                  onMouseMove={(e) =>
                                    setHoverPreview((prev) =>
                                      prev
                                        ? {
                                            ...prev,
                                            x: e.clientX + 18,
                                            y: e.clientY - 12,
                                          }
                                        : prev
                                    )
                                  }
                                  onMouseLeave={() => setHoverPreview(null)}
                                />
                              ) : (
                                <div className="h-14 w-10 rounded border border-gray-200 bg-gray-100 text-[10px] text-gray-400 flex items-center justify-center">
                                  n/a
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-2 font-mono text-xs text-gray-800">{c.id}</td>
                            <td className="px-4 py-2 text-gray-800">{c.name}</td>
                            <td className="px-4 py-2 text-gray-700">{c.set_name || c.set_id || "—"}</td>
                            <td className="px-4 py-2 text-gray-700">{c.number || "—"}</td>
                            <td className="px-4 py-2 text-gray-600">{ORIGIN_LABELS[c.origin] || c.origin}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {canLoadMoreIssueCards && (
                      <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between gap-3">
                        <p className="text-xs text-gray-500">
                          Showing {visibleCards.length.toLocaleString()} of {issueCards.length.toLocaleString()} cards.
                        </p>
                        <button
                          type="button"
                          onClick={() => setVisibleIssueCards((n) => n + ISSUE_CARDS_VISIBLE_PAGE)}
                          className="px-3 py-1.5 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50"
                        >
                          Load more
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {data?.healthCheckResults && (
              <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Recent health check results
                </div>
                {data.healthCheckResults.length === 0 ? (
                  <p className="px-4 py-4 text-sm text-gray-500">
                    No rows in <code className="font-mono">health_check_results</code> yet. Populate via a scheduled
                    job or SQL when you add automated checks.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100 text-left text-xs text-gray-500 uppercase">
                          <th className="px-4 py-2 font-medium">When</th>
                          <th className="px-4 py-2 font-medium">Severity</th>
                          <th className="px-4 py-2 font-medium">Type</th>
                          <th className="px-4 py-2 font-medium">Title</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {data.healthCheckResults.map((row) => (
                          <tr key={`${row.check_type}-${row.checked_at}-${row.title}`} className="align-top">
                            <td className="px-4 py-2 text-gray-600 whitespace-nowrap tabular-nums">
                              {row.checked_at
                                ? new Date(row.checked_at).toLocaleString(undefined, {
                                    dateStyle: "short",
                                    timeStyle: "short",
                                  })
                                : "—"}
                            </td>
                            <td className="px-4 py-2">
                              <span
                                className={
                                  row.severity === "error"
                                    ? "text-red-700 font-medium"
                                    : row.severity === "warn"
                                      ? "text-amber-800 font-medium"
                                      : "text-gray-700"
                                }
                              >
                                {row.severity || "info"}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-gray-700 font-mono text-xs">{row.check_type}</td>
                            <td className="px-4 py-2 text-gray-800">
                              <div>{row.title}</div>
                              {row.details && Object.keys(row.details).length > 0 && (
                                <pre className="mt-1 text-xs text-gray-500 font-mono whitespace-pre-wrap break-all max-h-24 overflow-y-auto">
                                  {JSON.stringify(row.details, null, 0)}
                                </pre>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            <p className="text-xs text-gray-500">
              Rows in <code className="font-mono">annotations</code> are created when a card is first saved in
              Workbench or Card Detail; cards never opened for edit may not have a row yet.
            </p>
          </div>
        )}
      </main>
      {hoverPreview?.src && (
        <div
          className="fixed z-[70] pointer-events-none rounded-lg border border-slate-300 bg-white/95 backdrop-blur-sm shadow-2xl p-2"
          style={{ left: hoverPreview.x, top: hoverPreview.y }}
        >
          {!hoverPreviewLoaded ? (
            <div className="w-48 max-w-[45vw] h-64 rounded bg-slate-200/70 animate-pulse" />
          ) : null}
          <img
            src={hoverPreview.src}
            alt={hoverPreview.name || "Card preview"}
            onLoad={() => setHoverPreviewLoaded(true)}
            className={`w-48 max-w-[45vw] rounded object-cover bg-gray-100 ${
              hoverPreviewLoaded ? "opacity-100" : "opacity-0 absolute"
            }`}
          />
        </div>
      )}
    </div>
  );
}
