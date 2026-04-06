import { StrictMode, useState, useEffect, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./index.css";
import { initDB, fetchExploreFilterOptions } from "./db";

/** Keep in sync with ExplorePage FILTER_OPTIONS_STALE_MS */
const FILTER_OPTIONS_STALE_MS = 30 * 60 * 1000;
import App from "./App.jsx";

const useSupabase =
  import.meta.env.VITE_USE_SUPABASE === "true" &&
  import.meta.env.VITE_SUPABASE_URL &&
  import.meta.env.VITE_SUPABASE_ANON_KEY;

function Root() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 60_000, retry: 1 },
        },
      }),
    []
  );

  useEffect(() => {
    const timeout = setTimeout(() => {
      setError("Load timed out (30s). Check the browser console for errors.");
    }, 30000);
    initDB()
      .then(() => {
        clearTimeout(timeout);
        void queryClient.prefetchQuery({
          queryKey: ["filterOptions", "explore"],
          queryFn: fetchExploreFilterOptions,
          staleTime: FILTER_OPTIONS_STALE_MS,
        });
        setReady(true);
      })
      .catch((err) => {
        clearTimeout(timeout);
        console.error("initDB error:", err);
        setError(err?.message || String(err));
      });
  }, [queryClient]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md mx-auto text-center p-8">
          <div className="text-green-600 text-5xl mb-4">!</div>
          <h1 className="text-xl font-bold text-gray-800 mb-2">
            Failed to load database
          </h1>
          <p className="text-sm text-gray-600 mb-4">{error}</p>
          <p className="text-xs text-gray-500 mb-4">
            If the app still fails to load, try an incognito window or disable browser extensions.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-green-600 text-white rounded text-sm font-medium hover:bg-green-700 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="inline-block w-10 h-10 border-4 border-green-600 border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-gray-600 text-sm">Loading Tropius Maximus...</p>
          <p className="text-gray-400 text-xs mt-1">
            {useSupabase
              ? "Connecting to Supabase…"
              : "Initializing DuckDB-WASM and loading card data"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </BrowserRouter>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
