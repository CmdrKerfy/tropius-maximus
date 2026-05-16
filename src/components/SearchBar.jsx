/**
 * SearchBar — Debounced text input for searching card names.
 *
 * Hybrid search: auto-searches after a longer pause, and submits immediately
 * from Enter or the Search button. This keeps typing responsive without
 * hammering the API on every typo correction.
 */

import { useState, useEffect, useRef } from "react";
import { Search, X } from "lucide-react";

export default function SearchBar({ value, onChange }) {
  // Local input value updates immediately for responsive typing feel.
  const [inputValue, setInputValue] = useState(value);
  const timerRef = useRef(null);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const submitSearch = (nextValue = inputValue) => {
    clearTimer();
    onChange(nextValue);
  };

  // Sync local value when parent resets it (e.g., clearing filters).
  useEffect(() => {
    setInputValue(value);
  }, [value]);

  const handleChange = (e) => {
    const newValue = e.target.value;
    setInputValue(newValue);

    clearTimer();

    // Longer debounce cuts typo-driven searches; Enter/Search button remains immediate.
    const delay = newValue.length > 0 && newValue.length < 3 ? 900 : 700;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      onChange(newValue);
    }, delay);
  };

  // Clean up timer on unmount.
  useEffect(() => {
    return () => {
      clearTimer();
    };
  }, []);

  return (
    <form
      className="relative"
      onSubmit={(e) => {
        e.preventDefault();
        submitSearch();
      }}
    >
      <label className="sr-only" htmlFor="explore-search">
        Search cards
      </label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400"
          strokeWidth={2}
          aria-hidden
        />
        <input
          id="explore-search"
          type="text"
          value={inputValue}
          onChange={handleChange}
          placeholder="Search cards by name..."
          aria-label="Search cards by name"
          className="w-full rounded-lg border border-gray-300 bg-white py-2.5 pl-10 pr-4 text-gray-900 placeholder-gray-400
                     focus:border-transparent focus:outline-none focus:ring-2 focus:ring-green-500"
        />
      </div>

      <div className="mt-2 flex items-center gap-2">
        <button
          type="submit"
          className="inline-flex items-center justify-center rounded-lg bg-tm-leaf px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-tm-leaf-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tm-mist"
        >
          Search
        </button>
        {inputValue && (
          <button
            type="button"
            onClick={() => {
              clearTimer();
              setInputValue("");
              onChange("");
            }}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
            aria-label="Clear search"
          >
            <X className="w-3.5 h-3.5" strokeWidth={2} aria-hidden />
            Clear
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-gray-400">Use + or | to search multiple names (e.g. Eevee + イーブイ)</p>
    </form>
  );
}
