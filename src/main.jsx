import { StrictMode, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { initDB } from "./db";
import App from "./App.jsx";

function Root() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    initDB()
      .then(() => setReady(true))
      .catch((err) => setError(err.message || String(err)));
  }, []);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md mx-auto text-center p-8">
          <div className="text-green-600 text-5xl mb-4">!</div>
          <h1 className="text-xl font-bold text-gray-800 mb-2">
            Failed to load database
          </h1>
          <p className="text-sm text-gray-600 mb-4">{error}</p>
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
            Initializing DuckDB-WASM and loading card data
          </p>
        </div>
      </div>
    );
  }

  return <App />;
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
