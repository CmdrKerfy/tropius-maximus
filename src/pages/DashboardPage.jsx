/**
 * Personal dashboard — recent edits and cards you created (Supabase).
 */
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  fetchProfile,
  fetchMyEditHistory,
  fetchMyCards,
} from "../db.js";
import AuthUserMenu from "../components/AuthUserMenu.jsx";
import { useExperimentalAppNav } from "../lib/navEnv.js";

export default function DashboardPage() {
  const experimentalNav = useExperimentalAppNav();
  const { data: profile, isLoading: pLoading } = useQuery({
    queryKey: ["profile"],
    queryFn: () => fetchProfile(),
  });

  const { data: edits = [], isLoading: eLoading } = useQuery({
    queryKey: ["myEditHistory"],
    queryFn: () => fetchMyEditHistory({ limit: 25 }),
  });

  const { data: myCards = [], isLoading: cLoading } = useQuery({
    queryKey: ["myCards"],
    queryFn: () => fetchMyCards({ limit: 25 }),
  });

  const display = profile?.display_name?.trim() || profile?.id?.slice(0, 8) || "there";

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
            <ul className="divide-y divide-gray-100 text-sm">
              {edits.map((row) => (
                <li key={`${row.id}-${row.edited_at}`} className="py-2 flex flex-wrap gap-2">
                  <span className="text-gray-500 whitespace-nowrap">
                    {row.edited_at ? new Date(row.edited_at).toLocaleString() : ""}
                  </span>
                  <Link
                    to={`/?card=${encodeURIComponent(row.card_id)}`}
                    className="text-green-700 font-medium hover:underline"
                  >
                    {row.card_id}
                  </Link>
                  <span className="text-gray-700">
                    {row.field_name}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
          <h3 className="text-base font-semibold text-gray-900 mb-3">My submitted cards</h3>
          <p className="text-xs text-gray-500 mb-3">
            Successful database inserts only. Use Explore’s custom card form for live per-attempt status in this session.
          </p>
          {cLoading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : myCards.length === 0 ? (
            <p className="text-sm text-gray-500">
              No manual cards with your user as creator yet. Add a custom card in Explore (Supabase mode) to see it here.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 text-sm">
              {myCards.map((row) => (
                <li key={row.id} className="py-2 flex flex-wrap gap-2 items-baseline">
                  <Link
                    to={`/?card=${encodeURIComponent(row.id)}`}
                    className="text-green-700 font-medium hover:underline"
                  >
                    {row.id}
                  </Link>
                  <span className="text-gray-800">{row.name}</span>
                  <span className="text-gray-500">
                    {row.set_name || row.set_id}
                    {row.origin ? ` · ${row.origin}` : ""}
                  </span>
                  {row.created_at && (
                    <span className="text-gray-400 text-xs ml-auto">
                      {new Date(row.created_at).toLocaleDateString()}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
