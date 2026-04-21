/**
 * Personal dashboard — recent edits and cards you created (Supabase).
 */
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  fetchProfile,
  fetchMyEditHistory,
  fetchMyCards,
  fetchCardThumbnailsByIds,
} from "../db.js";
import AuthUserMenu from "../components/AuthUserMenu.jsx";
import { useExperimentalAppNav } from "../lib/navEnv.js";

function cardThumb(row) {
  return row?.image_small || row?.image_large || "";
}

export default function DashboardPage() {
  const MY_CARDS_PAGE_SIZE = 75;
  const experimentalNav = useExperimentalAppNav();
  const [cardSetFilter, setCardSetFilter] = useState("");
  const [cardSearch, setCardSearch] = useState("");
  const [cardSort, setCardSort] = useState("set_number_asc");
  const [visibleMyCards, setVisibleMyCards] = useState(MY_CARDS_PAGE_SIZE);
  const [showOlderEdits, setShowOlderEdits] = useState(false);
  const [editWindow, setEditWindow] = useState("24h");
  const [showEditThumbs, setShowEditThumbs] = useState(false);

  const { data: profile, isLoading: pLoading } = useQuery({
    queryKey: ["profile"],
    queryFn: () => fetchProfile(),
  });

  const { data: edits = [], isLoading: eLoading } = useQuery({
    queryKey: ["myEditHistory"],
    queryFn: () => fetchMyEditHistory({ limit: 25 }),
  });
  const editCardIds = useMemo(
    () => [...new Set(edits.map((row) => String(row?.card_id || "")).filter(Boolean))],
    [edits]
  );
  const { data: editThumbsById = {} } = useQuery({
    queryKey: ["dashboardEditThumbs", editCardIds],
    queryFn: () => fetchCardThumbnailsByIds(editCardIds),
    enabled: showEditThumbs && editCardIds.length > 0,
    staleTime: 60_000,
  });

  const { data: myCards = [], isLoading: cLoading } = useQuery({
    queryKey: ["myCards", cardSetFilter, cardSearch, cardSort],
    queryFn: () =>
      fetchMyCards({
        limit: 1000,
        set_id: cardSetFilter,
        q: cardSearch,
        sort: cardSort,
      }),
  });

  const { data: myCardsFilterBase = [] } = useQuery({
    queryKey: ["myCardsSetOptions"],
    queryFn: () => fetchMyCards({ limit: 1000, sort: "set_number_asc" }),
  });

  const display = profile?.display_name?.trim() || profile?.id?.slice(0, 8) || "there";
  const { recentEdits, olderEdits } = useMemo(() => {
    const cutoffMs =
      editWindow === "7d"
        ? Date.now() - 7 * 24 * 60 * 60 * 1000
        : editWindow === "24h"
          ? Date.now() - 24 * 60 * 60 * 1000
          : Number.NEGATIVE_INFINITY;
    const recent = [];
    const older = [];
    for (const row of edits) {
      const ts = new Date(row?.edited_at || 0).getTime();
      if (Number.isFinite(ts) && ts >= cutoffMs) recent.push(row);
      else older.push(row);
    }
    return { recentEdits: recent, olderEdits: older };
  }, [edits, editWindow]);
  const cardSetOptions = useMemo(() => {
    const bySet = new Map();
    for (const row of myCardsFilterBase) {
      const sid = String(row.set_id || "").trim();
      if (!sid || bySet.has(sid)) continue;
      bySet.set(sid, row.set_name || sid);
    }
    return [...bySet.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" }));
  }, [myCardsFilterBase]);
  const cardsBySetSummary = useMemo(() => {
    const bySet = new Map();
    for (const row of myCards) {
      const sid = String(row.set_id || "").trim();
      if (!sid) continue;
      const prev = bySet.get(sid);
      if (prev) {
        prev.count += 1;
      } else {
        bySet.set(sid, {
          id: sid,
          name: row.set_name || sid,
          count: 1,
        });
      }
    }
    return [...bySet.values()].sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base" });
    });
  }, [myCards]);
  const displayedMyCards = useMemo(() => myCards.slice(0, visibleMyCards), [myCards, visibleMyCards]);
  const canLoadMoreMyCards = myCards.length > displayedMyCards.length;

  useEffect(() => {
    setVisibleMyCards(MY_CARDS_PAGE_SIZE);
  }, [cardSetFilter, cardSearch, cardSort]);
  useEffect(() => {
    setShowOlderEdits(false);
  }, [olderEdits.length]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      {!experimentalNav ? (
        <header className="bg-green-800 text-white shadow">
          <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-4">
              <h1 className="text-lg font-semibold">Dashboard</h1>
              <nav className="flex gap-3 text-sm text-green-100">
                <Link to="/" className="hover:text-white hover:underline">
                  Explore
                </Link>
                <Link to="/workbench" className="hover:text-white hover:underline">
                  Workbench
                </Link>
                <Link to="/history" className="hover:text-white hover:underline">
                  Edit history
                </Link>
                <Link to="/profile" className="hover:text-white hover:underline">
                  Profile
                </Link>
              </nav>
            </div>
            <AuthUserMenu />
          </div>
        </header>
      ) : null}

      <main className="max-w-6xl mx-auto px-4 py-8 space-y-8">
        {experimentalNav ? (
          <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">Dashboard</h1>
            <p className="text-gray-600 text-xs mt-0.5">Your recent activity and manual cards</p>
          </div>
        ) : null}
        <section>
          <h2 className="text-xl font-semibold text-gray-900 mb-1">Welcome, {pLoading ? "…" : display}</h2>
          <p className="text-sm text-gray-600">
            <strong>Recent edits</strong> lists annotation field changes (Workbench, card detail, batch).{" "}
            <strong>My submitted cards</strong> lists manual/custom cards that were saved to the database with your
            account as creator. Failed saves are not stored here—the custom card form keeps a per-session add list in
            your browser until you clear it.
          </p>
        </section>

        <section className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
          <h3 className="text-base font-semibold text-gray-900 mb-3">Recent edits</h3>
          <p className="text-xs text-gray-500 mb-3">
            Field-level annotation updates only (not “add card” creation).
          </p>
          {eLoading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : edits.length === 0 ? (
            <p className="text-sm text-gray-500">No edits recorded yet. Changes in Workbench or Batch appear here.</p>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                {[
                  { id: "24h", label: "24h" },
                  { id: "7d", label: "7d" },
                  { id: "all", label: "All" },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setEditWindow(opt.id)}
                    className={`text-[11px] px-2 py-1 rounded border ${
                      editWindow === opt.id
                        ? "border-green-300 bg-green-50 text-green-800"
                        : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setShowEditThumbs((v) => !v)}
                  className={`text-[11px] px-2 py-1 rounded border ${
                    showEditThumbs
                      ? "border-green-300 bg-green-50 text-green-800"
                      : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  {showEditThumbs ? "Hide thumbnails" : "Show thumbnails"}
                </button>
              </div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                {editWindow === "24h" ? "Last 24 hours" : editWindow === "7d" ? "Last 7 days" : "All edits"} (
                {recentEdits.length})
              </p>
              <ul className="divide-y divide-gray-100 text-sm">
                {recentEdits.map((row) => (
                  <li key={`${row.id}-${row.edited_at}`} className="py-2 flex flex-wrap gap-2 items-center">
                    {showEditThumbs ? (
                      editThumbsById[row.card_id]?.image_small || editThumbsById[row.card_id]?.image_large ? (
                        <img
                          src={editThumbsById[row.card_id]?.image_small || editThumbsById[row.card_id]?.image_large}
                          alt={row.card_id}
                          className="w-7 h-10 rounded border border-gray-200 object-cover bg-white shrink-0"
                          loading="lazy"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="w-7 h-10 rounded border border-gray-200 bg-gray-100 shrink-0" />
                      )
                    ) : null}
                    <span className="text-gray-500 whitespace-nowrap">
                      {row.edited_at ? new Date(row.edited_at).toLocaleString() : ""}
                    </span>
                    <Link
                      to={`/?card=${encodeURIComponent(row.card_id)}`}
                      className="text-green-700 font-medium hover:underline"
                    >
                      {row.card_id}
                    </Link>
                    <span className="text-gray-700">{row.field_name}</span>
                  </li>
                ))}
              </ul>
              {editWindow !== "all" && olderEdits.length > 0 && (
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => setShowOlderEdits((v) => !v)}
                    className="text-xs px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-700"
                  >
                    {showOlderEdits ? "Hide" : "Show"} older edits ({olderEdits.length})
                  </button>
                  {showOlderEdits && (
                    <ul className="mt-2 divide-y divide-gray-100 text-sm">
                      {olderEdits.map((row) => (
                        <li key={`${row.id}-${row.edited_at}`} className="py-2 flex flex-wrap gap-2 items-center">
                          {showEditThumbs ? (
                            editThumbsById[row.card_id]?.image_small ||
                            editThumbsById[row.card_id]?.image_large ? (
                              <img
                                src={
                                  editThumbsById[row.card_id]?.image_small ||
                                  editThumbsById[row.card_id]?.image_large
                                }
                                alt={row.card_id}
                                className="w-7 h-10 rounded border border-gray-200 object-cover bg-white shrink-0"
                                loading="lazy"
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <div className="w-7 h-10 rounded border border-gray-200 bg-gray-100 shrink-0" />
                            )
                          ) : null}
                          <span className="text-gray-500 whitespace-nowrap">
                            {row.edited_at ? new Date(row.edited_at).toLocaleString() : ""}
                          </span>
                          <Link
                            to={`/?card=${encodeURIComponent(row.card_id)}`}
                            className="text-green-700 font-medium hover:underline"
                          >
                            {row.card_id}
                          </Link>
                          <span className="text-gray-700">{row.field_name}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
        </section>

        <section className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
          <h3 className="text-base font-semibold text-gray-900 mb-3">My submitted cards</h3>
          <p className="text-xs text-gray-500 mb-3">
            Successful database inserts only. Use Explore’s custom card form for live per-attempt status in this session.
          </p>
          <div className="mb-3 grid grid-cols-1 md:grid-cols-4 gap-2">
            <div className="md:col-span-2">
              <label className="block text-[11px] font-medium text-gray-600 mb-1">Search (name or card ID)</label>
              <input
                value={cardSearch}
                onChange={(e) => setCardSearch(e.target.value)}
                placeholder="e.g. Pikachu or custom-myset-12"
                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-600 mb-1">Set</label>
              <select
                value={cardSetFilter}
                onChange={(e) => setCardSetFilter(e.target.value)}
                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
              >
                <option value="">All sets</option>
                {cardSetOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-600 mb-1">Sort</label>
              <select
                value={cardSort}
                onChange={(e) => setCardSort(e.target.value)}
                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
              >
                <option value="set_number_asc">Set then card number</option>
                <option value="recent_desc">Most recently added</option>
                <option value="name_asc">Name (A-Z)</option>
              </select>
            </div>
          </div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-gray-500">
              Showing {displayedMyCards.length.toLocaleString()} of {myCards.length.toLocaleString()} submitted cards.
            </p>
            <button
              type="button"
              onClick={() => {
                setCardSetFilter("");
                setCardSearch("");
                setCardSort("set_number_asc");
              }}
              className="text-[11px] px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-700"
            >
              Clear filters
            </button>
          </div>
          {!cLoading && cardsBySetSummary.length > 0 && (
            <div className="mb-3 rounded border border-gray-200 bg-gray-50 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-medium text-gray-600">Cards by set (current results):</span>
                {cardsBySetSummary.map((setRow) => (
                  <button
                    key={setRow.id}
                    type="button"
                    onClick={() => setCardSetFilter(setRow.id)}
                    className={`text-[11px] px-2 py-1 rounded border ${
                      cardSetFilter === setRow.id
                        ? "border-green-300 bg-green-50 text-green-800"
                        : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                    }`}
                    title={`Filter to ${setRow.name}`}
                  >
                    {setRow.name} ({setRow.count})
                  </button>
                ))}
              </div>
            </div>
          )}
          {cLoading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : myCards.length === 0 ? (
            <p className="text-sm text-gray-500">
              No manual cards with your user as creator yet. Add a custom card in Explore (Supabase mode) to see it here.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 text-sm">
              {displayedMyCards.map((row) => (
                <li key={row.id} className="py-2 flex items-start gap-2">
                  {cardThumb(row) ? (
                    <img
                      src={cardThumb(row)}
                      alt={row.name || row.id}
                      className="w-8 h-11 rounded border border-gray-200 object-cover bg-white shrink-0 mt-0.5"
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-8 h-11 rounded border border-gray-200 bg-gray-100 shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0 flex-1 flex flex-wrap gap-2 items-baseline">
                  <Link
                    to={`/?card=${encodeURIComponent(row.id)}`}
                    className="text-green-700 font-medium hover:underline"
                  >
                    {row.id}
                  </Link>
                  <span className="text-gray-800">{row.name}</span>
                  <span className="text-gray-500">
                    {row.set_name || row.set_id}
                    {row.number ? ` #${row.number}` : ""}
                    {row.origin ? ` · ${row.origin}` : ""}
                  </span>
                  {row.created_at && (
                    <span className="text-gray-400 text-xs ml-auto">
                      {new Date(row.created_at).toLocaleDateString()}
                    </span>
                  )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {!cLoading && canLoadMoreMyCards && (
            <div className="mt-3 flex items-center justify-end">
              <button
                type="button"
                onClick={() => setVisibleMyCards((n) => n + MY_CARDS_PAGE_SIZE)}
                className="px-3 py-1.5 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50"
              >
                Load more
              </button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
