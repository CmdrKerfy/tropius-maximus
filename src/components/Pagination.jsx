/**
 * Pagination — Compact page navigation with jump input.
 *
 * Replaces numbered buttons with Previous/Next, "Page X of Y", and
 * a small jump-to-page input. Scoped keyboard shortcuts when focused.
 */

import { useRef, useCallback } from "react";

export default function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  estimated = false,
  canGoNext = false,
}) {
  const inputRef = useRef(null);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const nextDisabled = !canGoNext && page >= totalPages;

  const handleJump = useCallback(() => {
    const clampPage = (n) => {
      const val = parseInt(n, 10);
      if (Number.isNaN(val)) return page;
      return Math.max(1, Math.min(totalPages, val));
    };
    const val = inputRef.current?.value ?? "";
    const target = clampPage(val);
    onPageChange(target);
    if (inputRef.current) inputRef.current.value = String(target);
  }, [page, totalPages, onPageChange]);

  const handleKeyDown = useCallback(
    (e) => {
      // Allow arrow keys to move cursor within the jump input
      if (e.target === inputRef.current && (e.key === "ArrowLeft" || e.key === "ArrowRight")) return;
      if (e.key === "ArrowLeft" && page > 1) {
        e.preventDefault();
        onPageChange(page - 1);
      } else if (e.key === "ArrowRight" && !nextDisabled) {
        e.preventDefault();
        onPageChange(page + 1);
      } else if (e.key === "Home") {
        e.preventDefault();
        onPageChange(1);
      } else if (e.key === "End") {
        e.preventDefault();
        onPageChange(totalPages);
      } else if (e.key === "Enter") {
        e.preventDefault();
        handleJump();
      }
    },
    [page, totalPages, onPageChange, handleJump, nextDisabled]
  );

  if (totalPages <= 1 && !canGoNext) return null;

  const btnBase =
    "px-3 py-1.5 text-sm rounded font-medium transition-colors";
  const btnInactive =
    "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50";
  const btnDisabled =
    "bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed";

  return (
    <div
      className="flex items-center justify-center gap-2 mt-6 mb-4 flex-wrap"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <button
        onClick={() => onPageChange(page - 1)}
        disabled={page === 1}
        className={`${btnBase} ${page === 1 ? btnDisabled : btnInactive}`}
      >
        Previous
      </button>

      <span className="text-sm text-gray-600 px-1">
        Page{" "}
        <span className="font-semibold text-gray-900">{page}</span>
        {" "}of{" "}
        <span className="font-semibold text-gray-900">{totalPages}</span>
        {estimated ? <span className="font-semibold text-gray-900">+</span> : null}
      </span>

      <input
        ref={inputRef}
        type="number"
        min={1}
        max={totalPages}
        defaultValue={page}
        onBlur={handleJump}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            handleJump();
          }
        }}
        className="w-14 px-1.5 py-1 text-sm text-center rounded border border-gray-300 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
        aria-label="Jump to page"
      />

      <button
        onClick={() => onPageChange(page + 1)}
        disabled={nextDisabled}
        className={`${btnBase} ${nextDisabled ? btnDisabled : btnInactive}`}
      >
        Next
      </button>
    </div>
  );
}
