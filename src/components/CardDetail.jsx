/**
 * CardDetail — Modal overlay showing full card information.
 *
 * Fetches the complete card data (including raw API payload and annotations)
 * when opened. Displays the large card image, key stats, attacks, weaknesses,
 * and the AnnotationEditor for user-defined fields.
 *
 * Closes when clicking the backdrop or pressing Escape.
 */

import { useState, useEffect } from "react";
import { fetchCard } from "../db";
import AnnotationEditor from "./AnnotationEditor";

export default function CardDetail({ cardId, attributes, onClose }) {
  const [card, setCard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch full card details when the modal opens.
  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchCard(cardId)
      .then(setCard)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [cardId]);

  // Close on Escape key.
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Prevent body scroll while modal is open.
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  // Parse JSON strings that might be in the raw_data.
  const parseJson = (val) => {
    if (typeof val === "string") {
      try {
        return JSON.parse(val);
      } catch {
        return val;
      }
    }
    return val;
  };

  // Extract useful data from the raw API payload.
  const raw = card ? (typeof card.raw_data === "string" ? JSON.parse(card.raw_data) : card.raw_data) : null;
  const attacks = raw?.attacks || [];
  const weaknesses = raw?.weaknesses || [];
  const resistances = raw?.resistances || [];
  const retreatCost = raw?.retreatCost || [];
  const abilities = raw?.abilities || [];
  const rules = raw?.rules || [];
  const subtypes = card ? parseJson(card.subtypes) : [];
  const types = card ? parseJson(card.types) : [];

  return (
    // Backdrop — clicking it closes the modal.
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full my-8 overflow-hidden">
        {/* Close button */}
        <div className="flex justify-end p-3">
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded-full transition-colors"
          >
            <svg
              className="w-6 h-6 text-gray-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Loading state */}
        {loading && (
          <div className="p-12 text-center text-gray-400">
            Loading card details...
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="p-12 text-center text-green-500">{error}</div>
        )}

        {/* Card content */}
        {card && !loading && (
          <div className="px-6 pb-6">
            <div className="flex flex-col md:flex-row gap-6">
              {/* Left: large card image */}
              <div className="flex-shrink-0">
                <img
                  src={card.image_large}
                  alt={card.name}
                  className="w-full md:w-72 rounded-lg shadow-md"
                />
              </div>

              {/* Right: card info */}
              <div className="flex-1 min-w-0">
                {/* Card name and basic info */}
                <h2 className="text-2xl font-bold">{card.name}</h2>
                <div className="flex flex-wrap gap-2 mt-2">
                  <span className="px-2 py-0.5 bg-gray-100 rounded text-sm text-gray-600">
                    {card.supertype}
                  </span>
                  {subtypes.map((s) => (
                    <span
                      key={s}
                      className="px-2 py-0.5 bg-gray-100 rounded text-sm text-gray-600"
                    >
                      {s}
                    </span>
                  ))}
                  {types.map((t) => (
                    <span
                      key={t}
                      className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-sm font-medium"
                    >
                      {t}
                    </span>
                  ))}
                  {card.hp && (
                    <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-sm font-medium">
                      HP {card.hp}
                    </span>
                  )}
                </div>

                {/* Set and card number */}
                <div className="mt-3 text-sm text-gray-500">
                  {card.set_name} ({card.set_series}) · #{card.number}
                  {card.pokedex_numbers?.length > 0 && (
                    <> · Pokedex: {card.pokedex_numbers.join(", ")}</>
                  )}
                  {card.rarity && ` · ${card.rarity}`}
                  {card.artist && ` · Artist: ${card.artist}`}
                </div>

                {/* Evolution info */}
                {card.evolves_from && (
                  <p className="mt-2 text-sm text-gray-600">
                    Evolves from: <strong>{card.evolves_from}</strong>
                  </p>
                )}

                {/* Auto-populated card identifiers */}
                {card.annotations?.unique_id && (
                  <p className="mt-2 text-sm text-gray-600">
                    Unique ID: <strong>{card.annotations.unique_id}</strong>
                  </p>
                )}
                {card.annotations?.evolution_line && (
                  <p className="mt-2 text-sm text-gray-600">
                    Evolution Line: <strong>{card.annotations.evolution_line}</strong>
                  </p>
                )}

                {/* Rules (for Trainer/Energy cards) */}
                {rules.length > 0 && (
                  <div className="mt-4">
                    <h3 className="font-semibold text-sm text-gray-700 mb-1">
                      Rules
                    </h3>
                    {rules.map((rule, i) => (
                      <p key={i} className="text-sm text-gray-600 mt-1">
                        {rule}
                      </p>
                    ))}
                  </div>
                )}

                {/* Abilities */}
                {abilities.length > 0 && (
                  <div className="mt-4">
                    <h3 className="font-semibold text-sm text-gray-700 mb-1">
                      Abilities
                    </h3>
                    {abilities.map((ab, i) => (
                      <div key={i} className="mt-2">
                        <p className="text-sm font-medium text-purple-700">
                          {ab.name}
                          <span className="text-gray-400 ml-1">
                            ({ab.type})
                          </span>
                        </p>
                        <p className="text-sm text-gray-600">{ab.text}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Flavor text */}
                {raw?.flavorText && (
                  <p className="mt-4 text-sm text-gray-600 italic border-l-2 border-gray-300 pl-3">
                    {raw.flavorText}
                  </p>
                )}

                {/* Attacks */}
                {attacks.length > 0 && (
                  <div className="mt-4">
                    <h3 className="font-semibold text-sm text-gray-700 mb-1">
                      Attacks
                    </h3>
                    {attacks.map((atk, i) => (
                      <div
                        key={i}
                        className="mt-2 p-2 bg-gray-50 rounded"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-sm">
                            {atk.name}
                          </span>
                          {atk.damage && (
                            <span className="text-green-600 font-bold text-sm">
                              {atk.damage}
                            </span>
                          )}
                        </div>
                        {atk.cost && (
                          <p className="text-xs text-gray-400 mt-0.5">
                            Cost: {atk.cost.join(", ")}
                          </p>
                        )}
                        {atk.text && (
                          <p className="text-sm text-gray-600 mt-1">
                            {atk.text}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Weaknesses, Resistances, Retreat Cost */}
                <div className="mt-4 flex flex-wrap gap-4 text-sm">
                  {weaknesses.length > 0 && (
                    <div>
                      <span className="font-semibold text-gray-700">
                        Weakness:{" "}
                      </span>
                      {weaknesses.map((w, i) => (
                        <span key={i} className="text-gray-600">
                          {w.type} {w.value}
                          {i < weaknesses.length - 1 ? ", " : ""}
                        </span>
                      ))}
                    </div>
                  )}
                  {resistances.length > 0 && (
                    <div>
                      <span className="font-semibold text-gray-700">
                        Resistance:{" "}
                      </span>
                      {resistances.map((r, i) => (
                        <span key={i} className="text-gray-600">
                          {r.type} {r.value}
                          {i < resistances.length - 1 ? ", " : ""}
                        </span>
                      ))}
                    </div>
                  )}
                  {retreatCost.length > 0 && (
                    <div>
                      <span className="font-semibold text-gray-700">
                        Retreat:{" "}
                      </span>
                      <span className="text-gray-600">
                        {retreatCost.length}
                      </span>
                    </div>
                  )}
                </div>

                {/* Regulation mark */}
                {card.regulation_mark && (
                  <p className="mt-2 text-xs text-gray-400">
                    Regulation Mark: {card.regulation_mark}
                  </p>
                )}

                {/* Market Prices */}
                {card.prices?.tcgplayer?.prices && (
                  <div className="mt-4">
                    <h3 className="font-semibold text-sm text-gray-700 mb-2">
                      Market Prices (USD)
                    </h3>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      {Object.entries(card.prices.tcgplayer.prices).map(
                        ([variant, p]) => (
                          <div
                            key={variant}
                            className="bg-gray-50 rounded p-2"
                          >
                            <span className="font-medium capitalize text-gray-700">
                              {variant.replace(/([A-Z])/g, " $1").trim()}
                            </span>
                            <div className="text-green-700 font-bold">
                              ${p.market?.toFixed(2) || "—"}
                            </div>
                            <div className="text-xs text-gray-500">
                              Low: ${p.low?.toFixed(2) || "—"} · High: $
                              {p.high?.toFixed(2) || "—"}
                            </div>
                          </div>
                        )
                      )}
                    </div>
                    {card.prices.tcgplayer.updatedAt && (
                      <p className="text-xs text-gray-400 mt-2">
                        Prices from TCGPlayer · Updated{" "}
                        {card.prices.tcgplayer.updatedAt}
                      </p>
                    )}
                    {card.prices.tcgplayer.url && (
                      <a
                        href={card.prices.tcgplayer.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:underline mt-1 inline-block"
                      >
                        View on TCGPlayer
                      </a>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Annotation editor — below the card info */}
            <div className="mt-6 border-t pt-6">
              <h3 className="font-semibold text-gray-700 mb-3">
                Your Annotations
              </h3>
              <AnnotationEditor
                cardId={card.id}
                annotations={
                  typeof card.annotations === "string"
                    ? JSON.parse(card.annotations)
                    : card.annotations || {}
                }
                attributes={attributes}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
