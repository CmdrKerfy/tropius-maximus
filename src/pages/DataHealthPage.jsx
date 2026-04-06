/**
 * Data Health — Phase 6: read-only Supabase snapshot (counts).
 */

import { NavLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchDataHealthSummary } from "../db";

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

export default function DataHealthPage() {
  const { data, isPending, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["dataHealthSummary"],
    queryFn: fetchDataHealthSummary,
    enabled: USE_SB,
    staleTime: 60_000,
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
              <h1 className="text-xl font-bold tracking-tight">Data Health</h1>
              <p className="text-green-100 text-xs">Counts from your Supabase project</p>
            </div>
          </div>
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
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
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
    </div>
  );
}
