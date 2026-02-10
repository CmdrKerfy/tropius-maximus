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
import { fetchCard, patchAnnotations } from "../db";
import AnnotationEditor from "./AnnotationEditor";

/**
 * CollapsibleSection — A reusable component for collapsible content areas.
 */
function CollapsibleSection({ title, defaultOpen = true, children }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 w-full text-left"
      >
        <svg
          className={`w-4 h-4 text-gray-500 transition-transform ${isOpen ? "rotate-90" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5l7 7-7 7"
          />
        </svg>
        <h3 className="font-semibold text-gray-700">{title}</h3>
      </button>
      {isOpen && <div className="mt-3">{children}</div>}
    </div>
  );
}

export default function CardDetail({ cardId, attributes, onClose, hasPrev, hasNext, onPrev, onNext }) {
  const [card, setCard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingImage, setEditingImage] = useState(false);
  const [newImageUrl, setNewImageUrl] = useState("");
  const [savingImage, setSavingImage] = useState(false);
  const [imageEnlarged, setImageEnlarged] = useState(false);

  // Fetch full card details when the modal opens or card changes.
  useEffect(() => {
    setLoading(true);
    setError(null);
    setImageEnlarged(false);
    setEditingImage(false);
    fetchCard(cardId)
      .then(setCard)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [cardId]);

  // Keyboard navigation: Escape, ArrowLeft, ArrowRight.
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") {
        if (imageEnlarged) {
          setImageEnlarged(false);
        } else {
          onClose();
        }
      }
      if (!imageEnlarged && !editingImage) {
        if (e.key === "ArrowLeft" && hasPrev) {
          onPrev();
        } else if (e.key === "ArrowRight" && hasNext) {
          onNext();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, imageEnlarged, editingImage, hasPrev, hasNext, onPrev, onNext]);

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
        {/* Top bar: navigation arrows + close button */}
        <div className="flex items-center justify-between p-3">
          <div className="flex items-center gap-1">
            <button
              onClick={onPrev}
              disabled={!hasPrev}
              className="p-1 hover:bg-gray-100 rounded-full transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Previous card"
            >
              <svg className="w-6 h-6 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              onClick={onNext}
              disabled={!hasNext}
              className="p-1 hover:bg-gray-100 rounded-full transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Next card"
            >
              <svg className="w-6 h-6 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
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
                {(() => {
                  const displayImage = card.annotations?.image_override || card.image_large;

                  // Image editing mode
                  if (editingImage) {
                    return (
                      <div className="w-full md:w-72 space-y-3">
                        <div className="space-y-2">
                          <label className="block text-sm font-medium text-gray-700">
                            Image URL
                          </label>
                          <input
                            type="url"
                            value={newImageUrl}
                            onChange={(e) => setNewImageUrl(e.target.value)}
                            placeholder="https://..."
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm
                                     focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                            autoFocus
                          />
                        </div>

                        {/* Preview */}
                        {newImageUrl && (
                          <div className="space-y-1">
                            <label className="block text-sm font-medium text-gray-700">
                              Preview
                            </label>
                            <img
                              src={newImageUrl}
                              alt="Preview"
                              className="w-full rounded-lg shadow-md bg-gray-100"
                              onError={(e) => {
                                e.target.style.display = "none";
                              }}
                              onLoad={(e) => {
                                e.target.style.display = "block";
                              }}
                            />
                          </div>
                        )}

                        {/* Action buttons */}
                        <div className="flex gap-2">
                          <button
                            onClick={async () => {
                              if (!newImageUrl.trim()) return;
                              setSavingImage(true);
                              try {
                                const updated = await patchAnnotations(cardId, {
                                  image_override: newImageUrl.trim(),
                                });
                                setCard((prev) => ({
                                  ...prev,
                                  annotations: updated,
                                }));
                                setEditingImage(false);
                                setNewImageUrl("");
                              } catch (err) {
                                console.error("Failed to save image:", err);
                              } finally {
                                setSavingImage(false);
                              }
                            }}
                            disabled={!newImageUrl.trim() || savingImage}
                            className="flex-1 px-3 py-2 bg-green-600 text-white text-sm font-medium
                                     rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed
                                     transition-colors"
                          >
                            {savingImage ? "Saving..." : "Save"}
                          </button>
                          <button
                            onClick={() => {
                              setEditingImage(false);
                              setNewImageUrl("");
                            }}
                            className="px-3 py-2 bg-gray-100 text-gray-700 text-sm font-medium
                                     rounded-lg hover:bg-gray-200 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    );
                  }

                  // Display image or placeholder
                  return displayImage ? (
                    <div className="relative group">
                      <img
                        src={displayImage}
                        alt={card.name}
                        className="w-full md:w-72 rounded-lg shadow-md cursor-pointer"
                        onClick={() => setImageEnlarged(true)}
                      />
                      {/* Edit button overlay */}
                      <button
                        onClick={() => {
                          setNewImageUrl(card.annotations?.image_override || "");
                          setEditingImage(true);
                        }}
                        className="absolute top-2 right-2 p-2 bg-black/50 text-white rounded-full
                                 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
                        title="Change image"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                    </div>
                  ) : (
                    <div className="w-full md:w-72 aspect-[2.5/3.5] bg-gray-100 rounded-lg shadow-md
                                  flex flex-col items-center justify-center gap-3">
                      <svg
                        className="w-16 h-16 text-gray-300"
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
                      <span className="text-gray-400 text-sm">No Image</span>
                      <button
                        onClick={() => setEditingImage(true)}
                        className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg
                                 hover:bg-green-700 transition-colors flex items-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Add Image
                      </button>
                    </div>
                  );
                })()}
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

                {/* Species genus (e.g., "Seed Pokémon") */}
                {card.genus && (
                  <p className="mt-2 text-sm text-gray-600 italic">
                    {card.genus}
                  </p>
                )}

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
              <CollapsibleSection title="Custom Attributes" defaultOpen={false}>
                <AnnotationEditor
                  cardId={card.id}
                  annotations={
                    typeof card.annotations === "string"
                      ? JSON.parse(card.annotations)
                      : card.annotations || {}
                  }
                  attributes={attributes}
                />
              </CollapsibleSection>
            </div>
          </div>
        )}
      </div>

      {/* Enlarged image overlay */}
      {imageEnlarged && card && (
        <div
          className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center cursor-pointer"
          onClick={() => setImageEnlarged(false)}
        >
          <img
            src={card.annotations?.image_override || card.image_large}
            alt={card.name}
            className="max-h-[90vh] max-w-[90vw] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
