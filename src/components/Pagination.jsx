/**
 * Pagination — Page navigation controls.
 *
 * Shows Previous/Next buttons and the current page indicator.
 * Page numbers are 1-based to match the API.
 */

export default function Pagination({ page, pageSize, total, onPageChange }) {
  const totalPages = Math.ceil(total / pageSize);

  // Don't render if there's only one page.
  if (totalPages <= 1) return null;

  // Build a window of page numbers around the current page.
  // Shows up to 7 page buttons with ellipsis gaps.
  const getPageNumbers = () => {
    const pages = [];
    const maxVisible = 7;

    if (totalPages <= maxVisible) {
      // Show all pages if there are few enough.
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      // Always show first page.
      pages.push(1);

      // Calculate the window around the current page.
      let start = Math.max(2, page - 2);
      let end = Math.min(totalPages - 1, page + 2);

      // Adjust window to always show 5 middle pages.
      if (page <= 3) end = Math.min(6, totalPages - 1);
      if (page >= totalPages - 2) start = Math.max(totalPages - 5, 2);

      // Add ellipsis before the window if needed.
      if (start > 2) pages.push("...");

      for (let i = start; i <= end; i++) pages.push(i);

      // Add ellipsis after the window if needed.
      if (end < totalPages - 1) pages.push("...");

      // Always show last page.
      pages.push(totalPages);
    }

    return pages;
  };

  const btnBase =
    "px-3 py-1.5 text-sm rounded font-medium transition-colors";
  const btnActive = "bg-green-600 text-white";
  const btnInactive =
    "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50";
  const btnDisabled = "bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed";

  return (
    <div className="flex items-center justify-center gap-1.5 mt-6 mb-4 flex-wrap">
      {/* Previous button */}
      <button
        onClick={() => onPageChange(page - 1)}
        disabled={page === 1}
        className={`${btnBase} ${page === 1 ? btnDisabled : btnInactive}`}
      >
        Previous
      </button>

      {/* Page number buttons */}
      {getPageNumbers().map((p, i) =>
        p === "..." ? (
          <span key={`ellipsis-${i}`} className="px-2 text-gray-400">
            ...
          </span>
        ) : (
          <button
            key={p}
            onClick={() => onPageChange(p)}
            className={`${btnBase} ${p === page ? btnActive : btnInactive}`}
          >
            {p}
          </button>
        )
      )}

      {/* Next button */}
      <button
        onClick={() => onPageChange(page + 1)}
        disabled={page === totalPages}
        className={`${btnBase} ${page === totalPages ? btnDisabled : btnInactive}`}
      >
        Next
      </button>
    </div>
  );
}
