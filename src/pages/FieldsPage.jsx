/**
 * Field Management — Phase 6: custom `field_definitions` (Supabase) or v1 attributes (DuckDB).
 */

import { NavLink } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchAttributes } from "../db";
import AttributeManager from "../components/AttributeManager";

const USE_SB =
  import.meta.env.VITE_USE_SUPABASE === "true" &&
  Boolean(import.meta.env.VITE_SUPABASE_URL) &&
  Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY);

const navLinkClass = ({ isActive }) =>
  `px-3 py-1.5 rounded text-sm font-medium transition-colors ${
    isActive ? "bg-white text-green-700" : "bg-green-700 hover:bg-green-800 text-white"
  }`;

export default function FieldsPage() {
  const queryClient = useQueryClient();
  const { data: attributes = [], isPending, isError, error } = useQuery({
    queryKey: ["attributes"],
    queryFn: fetchAttributes,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["attributes"] });
  };

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
              <h1 className="text-xl font-bold tracking-tight">Field management</h1>
              <p className="text-green-100 text-xs">
                Custom fields appear in Workbench and Card Detail (stored in{" "}
                <code className="text-green-50/90">annotations.extra</code> when not a typed column)
              </p>
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

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-4">
        {USE_SB && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Apply migration{" "}
            <code className="font-mono text-xs">010_field_definitions_number_type.sql</code> in Supabase if
            you use <strong>Number</strong> fields (adds <code className="font-mono">number</code> to{" "}
            <code className="font-mono">field_type</code>).
          </div>
        )}

        {isPending && <p className="text-sm text-gray-500">Loading field definitions…</p>}
        {isError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error?.message || "Could not load fields."}
          </div>
        )}

        {!isPending && !isError && (
          <AttributeManager attributes={attributes} onChanged={refresh} />
        )}
      </main>
    </div>
  );
}
