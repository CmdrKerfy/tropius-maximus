/**
 * SearchBar — Debounced text input for searching card names.
 *
 * Waits 300ms after the user stops typing before triggering a search.
 * This avoids hammering the API with a request on every keystroke.
 * The debounce is implemented with a simple setTimeout/clearTimeout pattern.
 */

import { useState, useEffect, useRef } from "react";

export default function SearchBar({ value, onChange }) {
  // Local input value updates immediately for responsive typing feel.
  const [inputValue, setInputValue] = useState(value);
  const timerRef = useRef(null);

  // Sync local value when parent resets it (e.g., clearing filters).
  useEffect(() => {
    setInputValue(value);
  }, [value]);

  const handleChange = (e) => {
    const newValue = e.target.value;
    setInputValue(newValue);

    // Clear any pending debounce timer.
    if (timerRef.current) clearTimeout(timerRef.current);

    // Wait 300ms before notifying the parent, so we don't search on every keystroke.
    timerRef.current = setTimeout(() => {
      onChange(newValue);
    }, 300);
  };

  // Clean up timer on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div className="relative">
      {/* Search icon */}
      <svg
        className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
        />
      </svg>

      <input
        type="text"
        value={inputValue}
        onChange={handleChange}
        placeholder="Search cards by name..."
        className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg
                   focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent
                   bg-white text-gray-900 placeholder-gray-400"
      />

      {/* Clear button — only shown when there's text in the input */}
      {inputValue && (
        <button
          onClick={() => {
            setInputValue("");
            onChange("");
          }}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400
                     hover:text-gray-600 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      )}
    </div>
  );
}
