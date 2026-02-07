/**
 * CardGrid — Responsive grid of card images.
 *
 * Displays cards in a CSS Grid layout that adapts from 2 columns on mobile
 * to 6 columns on large screens. Each card is clickable to open the detail modal.
 * Shows a loading skeleton while cards are being fetched.
 */

export default function CardGrid({ cards, loading, onCardClick }) {
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
      {cards.map((card) => (
        <button
          key={card.id}
          onClick={() => onCardClick(card.id)}
          className="group relative rounded-lg overflow-hidden shadow-sm hover:shadow-xl
                     transition-all duration-200 hover:scale-105 focus:outline-none
                     focus:ring-2 focus:ring-green-500 focus:ring-offset-2 bg-white"
        >
          <img
            src={card.image_small}
            alt={card.name}
            className="w-full h-auto"
            loading="lazy"
          />
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
      ))}
    </div>
  );
}
