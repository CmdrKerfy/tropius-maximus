/**
 * CardGrid — Responsive grid of card images.
 *
 * Displays cards in a CSS Grid layout that adapts from 2 columns on mobile
 * to 6 columns on large screens. Each card is clickable to open the detail modal.
 * Shows a loading skeleton while cards are being fetched.
 *
 * When SQL console is open, cards can be selected for bulk operations via checkboxes.
 */

export default function CardGrid({
  cards,
  loading,
  onCardClick,
  selectedCardIds = new Set(),
  onToggleSelection,
}) {
  // Loading state: show placeholder skeleton cards.
  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="aspect-[2.5/3.5] bg-gray-200 rounded-lg animate-pulse"
          />
        ))}
      </div>
    );
  }

  // Empty state: no cards match the current search/filters.
  if (cards.length === 0) {
    return (
      <div className="text-center py-16 text-gray-400">
        <p className="text-lg">No cards found</p>
        <p className="text-sm mt-1">Try adjusting your search or filters</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
      {cards.map((card) => {
        const isSelected = selectedCardIds.has(card.id);
        const displayImage = card.annotations?.image_override || card.image_small;
        return (
          <div key={card.id} className="relative">
            {/* Selection checkbox (only shown when SQL console is open) */}
            {onToggleSelection && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleSelection(card.id);
                }}
                className={`absolute top-2 left-2 z-10 w-6 h-6 rounded-full border-2 flex items-center justify-center
                           transition-colors ${
                             isSelected
                               ? "bg-green-500 border-green-500"
                               : "bg-white/80 border-gray-300 hover:border-green-400"
                           }`}
                aria-label={isSelected ? "Deselect card" : "Select card"}
              >
                {isSelected && (
                  <svg
                    className="w-4 h-4 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={3}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                )}
              </button>
            )}

            {/* Selection overlay */}
            {isSelected && (
              <div className="absolute inset-0 bg-green-500/20 rounded-lg pointer-events-none z-[5]" />
            )}

            <button
              onClick={() => onCardClick(card.id)}
              className={`group relative rounded-lg overflow-hidden shadow-sm hover:shadow-xl
                         transition-all duration-200 hover:scale-105 focus:outline-none
                         focus:ring-2 focus:ring-green-500 focus:ring-offset-2 bg-white
                         ${isSelected ? "ring-2 ring-green-500" : ""}`}
            >
              {displayImage ? (
                <img
                  src={displayImage}
                  alt={card.name}
                  className="w-full h-auto"
                  loading="lazy"
                  onError={(e) => {
                    if (card.image_fallback && e.target.src !== card.image_fallback) {
                      e.target.src = card.image_fallback;
                    }
                  }}
                />
              ) : (
                <div className="aspect-[2.5/3.5] bg-gray-100 flex items-center justify-center">
                  <svg
                    className="w-12 h-12 text-gray-300"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                    />
                  </svg>
                </div>
              )}
              {/* Card name overlay on hover */}
              <div
                className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent
                            p-2 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <p className="text-white text-xs font-medium truncate">
                  {card.name || "Unknown"}
                </p>
                {(card.set_name || card.number) && (
                  <p className="text-gray-300 text-xs">
                    {card.set_name && card.number
                      ? `${card.set_name} · ${card.number}`
                      : card.set_name || card.number}
                  </p>
                )}
              </div>
            </button>
          </div>
        );
      })}
    </div>
  );
}
