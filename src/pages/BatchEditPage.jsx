/**
 * Batch annotation edit — saved list from Explore (wizard); no URL-scoped scope.
 */

import { NavLink, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import WorkflowModeHelp from "../components/WorkflowModeHelp.jsx";
import BatchWizard from "../components/BatchWizard.jsx";
import { useBatchSelection } from "../hooks/useBatchSelection.js";
import { fetchAttributes } from "../db";
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

export default function BatchEditPage() {
  const experimentalNav = useExperimentalAppNav();
  const batchSelection = useBatchSelection(USE_SB);

  const { data: attributes = [], isPending: attrPending } = useQuery({
    queryKey: ["attributes"],
    queryFn: fetchAttributes,
    enabled: USE_SB,
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
                <h1 className="text-xl font-bold tracking-tight">Batch edit</h1>
                <p className="text-green-100 text-xs">
                  Apply one or more annotation fields to your saved batch list from Explore
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <nav className="flex flex-wrap items-center gap-2">
                <NavLink to="/" className={navLinkClass} end title="Home — build your batch list here">
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

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        {experimentalNav ? (
          <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">Batch edit</h1>
            <p className="text-gray-600 text-xs mt-0.5">
              Apply one or more annotation fields to your saved batch list from Explore
            </p>
          </div>
        ) : null}
        {!USE_SB && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Batch edit uses Supabase. Set <code className="font-mono">VITE_USE_SUPABASE=true</code> and your Supabase
            env vars, then sign in.
          </div>
        )}

        {USE_SB && (
          <>
            {batchSelection.count > 0 ? (
              <BatchWizard batchSelection={batchSelection} attributes={attributes} attrPending={attrPending} />
            ) : (
              <>
                <div className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-8 text-center text-sm text-gray-700 shadow-sm">
                  <p className="font-medium text-gray-900">No cards in your batch list yet</p>
                  <p className="mt-2">
                    On{" "}
                    <Link to="/" className="text-green-700 font-medium underline">
                      Explore
                    </Link>
                    , use checkboxes and <strong>Add all matching</strong> (up to the safety cap), then open Batch again.
                  </p>
                </div>

                <WorkflowModeHelp summary="About Batch edit — how it works">
                  <p>
                    <strong>Primary workflow:</strong> build a card list on{" "}
                    <Link to="/" className="text-green-700 font-medium underline">
                      Explore
                    </Link>{" "}
                    (checkboxes + optional select-all), then return here to run the stepped flow: field → review → confirm
                    → apply.
                  </p>
                  <ul className="list-disc space-y-1.5 pl-5">
                    <li>
                      The list is stored in your browser and persists when you change filters or refresh. It is{" "}
                      <strong>not</strong> tied to the Explore URL.
                    </li>
                    <li>
                      Use Batch when the <strong>same</strong> set of annotation field value(s) should apply to{" "}
                      <strong>all</strong> cards in that list (one field, or several fields in one pass).
                    </li>
                    <li>
                      If cards need <strong>different</strong> values each time, use <strong>Explore / card detail</strong>{" "}
                      or <strong>Workbench</strong> instead.
                    </li>
                    <li>
                      To narrow candidates before adding them, use filters on{" "}
                      <Link to="/" className="text-green-700 font-medium underline">
                        Explore
                      </Link>{" "}
                      (Action, Pose, set, search, and so on), then add cards or use <strong>Add all matching</strong>.
                    </li>
                  </ul>
                </WorkflowModeHelp>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
