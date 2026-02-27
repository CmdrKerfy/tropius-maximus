/**
 * CardDetail — Modal overlay showing full card information.
 *
 * Fetches the complete card data (including raw API payload and annotations)
 * when opened. Displays the large card image, key stats, attacks, weaknesses,
 * and editable Annotations / Video / Notes sections matching the Add a Card form.
 *
 * Closes when clicking the backdrop or pressing Escape.
 */

import { useState, useEffect, useRef } from "react";
import { fetchCard, patchAnnotations, fetchFormOptions, exportAllAnnotations } from "../db";
import { getToken, getAnnotationsFileContents, updateAnnotationsFileContents } from "../lib/github";
import ComboBox from "./ComboBox";
import MultiComboBox from "./MultiComboBox";
import {
  CARD_SUBCATEGORY_OPTIONS, HELD_ITEM_OPTIONS, POKEBALL_OPTIONS,
  EVOLUTION_ITEMS_OPTIONS, BERRIES_OPTIONS, HOLIDAY_THEME_OPTIONS,
  MULTI_CARD_OPTIONS, TRAINER_CARD_TYPE_OPTIONS, TRAINER_CARD_SUBGROUP_OPTIONS,
  VIDEO_TYPE_OPTIONS, TOP_10_THEMES_OPTIONS, WTPC_EPISODE_OPTIONS,
  VIDEO_REGION_OPTIONS, VIDEO_LOCATION_OPTIONS, STAMP_OPTIONS,
} from "../lib/annotationOptions";

const COLOR_OPTIONS = [
  "black", "blue", "brown", "gray", "green", "pink", "purple", "red", "white", "yellow",
];
const SHAPE_OPTIONS = [
  "ball", "squiggle", "fish", "arms", "blob", "upright", "legs",
  "quadruped", "wings", "tentacles", "heads", "humanoid", "bug-wings", "armor",
];
const VIDEO_GAME_OPTIONS = [
  "Red/Blue", "Gold/Silver", "Ruby/Sapphire", "FireRed/LeafGreen",
  "Diamond/Pearl", "Platinum", "HeartGold/SoulSilver",
  "Black/White", "Black 2/White 2", "X/Y", "Omega Ruby/Alpha Sapphire",
  "Sun/Moon", "Ultra Sun/Ultra Moon", "Let's Go Pikachu/Eevee",
  "Sword/Shield", "Brilliant Diamond/Shining Pearl",
  "Legends Arceus", "Scarlet/Violet", "Other",
];

const MULTI_VALUE_ANNOTATION_KEYS = new Set([
  "art_style", "main_character", "background_pokemon", "background_humans",
  "additional_characters", "background_details",
  "card_subcategory", "trainer_card_subgroup", "evolution_items",
  "berries", "holiday_theme", "multi_card",
  "video_game", "video_game_location", "video_title", "video_type", "top_10_themes", "wtpc_episode",
  "video_region", "video_location",
]);

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

function parseAnnotations(card) {
  if (!card?.annotations) return {};
  const a = card.annotations;
  if (typeof a === "string") {
    try {
      return JSON.parse(a);
    } catch {
      return {};
    }
  }
  return a;
}

export default function CardDetail({ cardId, attributes, source = "TCG", onClose, hasPrev, hasNext, onPrev, onNext }) {
  const [card, setCard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingImage, setEditingImage] = useState(false);
  const [newImageUrl, setNewImageUrl] = useState("");
  const [savingImage, setSavingImage] = useState(false);
  const [imageEnlarged, setImageEnlarged] = useState(false);
  const [formOpts, setFormOpts] = useState({});
  const ghPushTimer = useRef(null);

  useEffect(() => {
    fetchFormOptions().then(setFormOpts).catch((err) => console.warn("Failed to load form options:", err.message));
  }, []);

  // Fetch full card details when the modal opens or card changes.
  useEffect(() => {
    setLoading(true);
    setError(null);
    setImageEnlarged(false);
    setEditingImage(false);
    fetchCard(cardId, source)
      .then(setCard)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [cardId, source]);

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

  const ann = card ? parseAnnotations(card) : {};
  const opts = formOpts || {};
  const inputClass =
    "w-full px-3 py-1.5 border border-gray-300 rounded text-sm " +
    "focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent";
  const labelClass = "block text-sm font-medium text-gray-700 mb-1";

  useEffect(() => () => clearTimeout(ghPushTimer.current), []);

  const scheduleGitHubPush = () => {
    const token = getToken();
    if (!token) return;
    clearTimeout(ghPushTimer.current);
    ghPushTimer.current = setTimeout(async () => {
      try {
        const allAnnotations = await exportAllAnnotations();
        const { sha } = await getAnnotationsFileContents(token);
        await updateAnnotationsFileContents(
          token,
          allAnnotations,
          sha,
          `CardDetail: update annotations for ${card?.name ?? "card"}`
        );
      } catch (err) {
        console.warn("CardDetail GitHub push failed:", err.message);
      }
    }, 1000);
  };

  const saveAnnotation = async (key, value) => {
    let stored = value;
    if (MULTI_VALUE_ANNOTATION_KEYS.has(key) && typeof value === "string") {
      stored = value ? value.split(",").map((s) => s.trim()).filter(Boolean) : [];
    }
    if (key === "background_pokemon" && Array.isArray(stored)) {
      stored = stored.map((s) => s.toLowerCase());
    }
    try {
      await patchAnnotations(card.id, { [key]: stored });
      setCard((prev) => ({
        ...prev,
        annotations: { ...parseAnnotations(prev), [key]: stored },
      }));
      scheduleGitHubPush();
    } catch (err) {
      console.error("Failed to save annotation:", err);
    }
  };

  const annValue = (key, multi = false) => {
    const v = ann[key];
    if (multi && Array.isArray(v)) return v.join(", ");
    if (v === null || v === undefined) return "";
    return String(v);
  };

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
                  const displayImage = ann.image_override || card.image_large;

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
                        onError={(e) => {
                          if (card.image_fallback && e.target.src !== card.image_fallback) {
                            e.target.src = card.image_fallback;
                          }
                        }}
                      />
                      {/* Edit button overlay */}
                      <button
                        onClick={() => {
                          setNewImageUrl(ann.image_override || "");
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
                {card.alt_name && (
                  <p className="text-lg text-gray-500">{card.alt_name}</p>
                )}
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
                  {ann.set_name || card.set_name} ({card.set_series}) · #{card.number}
                  {card.pokedex_numbers?.length > 0 && (
                    <> · Pokedex: {card.pokedex_numbers.join(", ")}</>
                  )}
                  {card.rarity && ` · ${card.rarity}`}
                  {card.special_rarity && ` · ${card.special_rarity}`}
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

                {/* Pocket-specific fields */}
                {card.stage && (
                  <p className="mt-2 text-sm text-gray-600">
                    Stage: <strong>{card.stage}</strong>
                  </p>
                )}
                {card.packs && card.packs.length > 0 && (
                  <p className="mt-2 text-sm text-gray-600">
                    Packs: <strong>{card.packs.join(", ")}</strong>
                  </p>
                )}
                {card.retreat_cost != null && card.retreat_cost > 0 && (
                  <p className="mt-2 text-sm text-gray-600">
                    Retreat Cost: <strong>{card.retreat_cost}</strong>
                  </p>
                )}

                {/* Auto-populated card identifiers */}
                {ann.unique_id && (
                  <p className="mt-2 text-sm text-gray-600">
                    Unique ID: <strong>{ann.unique_id}</strong>
                  </p>
                )}
                {(ann.evolution_line && (Array.isArray(ann.evolution_line) ? ann.evolution_line.length : ann.evolution_line)) && (
                  <p className="mt-2 text-sm text-gray-600">
                    Evolution Line: <strong>{Array.isArray(ann.evolution_line) ? ann.evolution_line.join(" → ") : ann.evolution_line}</strong>
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

            {/* Annotations, Video, Notes — same grouping as Add a Card form */}
            <div className="mt-6 border-t pt-6 space-y-4">
              {/* No-token warning — shown above collapsed Annotations section */}
              {getToken() ? (
                <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
                  GitHub PAT configured — annotation changes will sync across devices.
                </div>
              ) : (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                  No GitHub PAT configured — annotation changes will only save locally to this browser.
                  Add a PAT in Settings to sync across devices.
                </div>
              )}
              <CollapsibleSection title="Annotations" defaultOpen={false}>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">

                  {/* ── Card Classification ── */}
                  <div className="col-span-2 md:col-span-3 flex items-center gap-2 pt-2 mt-1">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Card Classification</span>
                    <div className="flex-1 h-px bg-gray-200" />
                  </div>
                  <div className="col-span-2 md:col-span-3">
                    <label className={labelClass}>Set Name</label>
                    <ComboBox
                      value={annValue("set_name") || card.set_name || ""}
                      onChange={(v) => saveAnnotation("set_name", v)}
                      options={opts.setName || []}
                      placeholder="Set name"
                      className={inputClass + " w-full"}
                    />
                  </div>
                  <div className="col-span-2 md:col-span-3">
                    <label className={labelClass}>Card Subcategory</label>
                    <MultiComboBox value={annValue("card_subcategory", true)} onChange={(v) => saveAnnotation("card_subcategory", v)} options={opts.cardSubcategory || CARD_SUBCATEGORY_OPTIONS} placeholder="Full Art, Alternate Arts" />
                  </div>
                  <div>
                    <label className={labelClass}>Trainer Card Type</label>
                    <ComboBox value={annValue("trainer_card_type")} onChange={(v) => saveAnnotation("trainer_card_type", v)} options={opts.trainerCardType || TRAINER_CARD_TYPE_OPTIONS} placeholder="Item" className={inputClass + " w-full"} />
                  </div>
                  <div className="col-span-2">
                    <label className={labelClass}>Trainer Card Subgroup</label>
                    <MultiComboBox value={annValue("trainer_card_subgroup", true)} onChange={(v) => saveAnnotation("trainer_card_subgroup", v)} options={opts.trainerCardSubgroup || TRAINER_CARD_SUBGROUP_OPTIONS} placeholder="Nameless Supporter" />
                  </div>
                  <div>
                    <label className={labelClass}>Stamp</label>
                    <ComboBox value={annValue("stamp")} onChange={(v) => saveAnnotation("stamp", v)}
                      options={opts.stamp || STAMP_OPTIONS} placeholder="Pokemon Day"
                      className={inputClass + " w-full"} />
                  </div>
                  <div className="flex items-center gap-2 pt-6">
                    <input type="checkbox" id="cardDetail-pocketExclusive"
                      checked={!!ann.pocket_exclusive}
                      onChange={(e) => saveAnnotation("pocket_exclusive", e.target.checked)}
                      className="rounded" />
                    <label htmlFor="cardDetail-pocketExclusive" className="text-sm text-gray-700">Pocket Exclusive</label>
                  </div>

                  {/* ── Background Characters ── */}
                  <div className="col-span-2 md:col-span-3 flex items-center gap-2 pt-2 mt-1">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Background Characters</span>
                    <div className="flex-1 h-px bg-gray-200" />
                  </div>
                  <div>
                    <label className={labelClass}>Background Pokemon</label>
                    <MultiComboBox value={annValue("background_pokemon", true)} onChange={(v) => saveAnnotation("background_pokemon", v)} options={opts.backgroundPokemon || []} placeholder="Bulbasaur, Squirtle" />
                  </div>
                  <div>
                    <label className={labelClass}>Background Humans</label>
                    <MultiComboBox value={annValue("background_humans", true)} onChange={(v) => saveAnnotation("background_humans", v)} options={opts.backgroundHumans || []} placeholder="Ash, Misty" />
                  </div>
                  <div>
                    <label className={labelClass}>Additional Characters</label>
                    <MultiComboBox value={annValue("additional_characters", true)} onChange={(v) => saveAnnotation("additional_characters", v)} options={opts.additionalCharacters || []} placeholder="Friends, Rivals" />
                  </div>
                  <div className="col-span-2 md:col-span-3">
                    <label className={labelClass}>Evolution Line</label>
                    <ComboBox value={annValue("evolution_line")} onChange={(v) => saveAnnotation("evolution_line", v)} options={opts.evolutionLine || []} placeholder="Pichu → Pikachu → Raichu" className={inputClass + " w-full"} />
                  </div>

                  {/* ── Subject ── */}
                  <div className="col-span-2 md:col-span-3 flex items-center gap-2 pt-2 mt-1">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Subject</span>
                    <div className="flex-1 h-px bg-gray-200" />
                  </div>
                  <div>
                    <label className={labelClass}>Emotion</label>
                    <ComboBox value={annValue("emotion")} onChange={(v) => saveAnnotation("emotion", v)} options={opts.emotion || []} placeholder="Happy" className={inputClass + " w-full"} />
                  </div>
                  <div>
                    <label className={labelClass}>Pose</label>
                    <ComboBox value={annValue("pose")} onChange={(v) => saveAnnotation("pose", v)} options={opts.pose || []} placeholder="Jumping" className={inputClass + " w-full"} />
                  </div>
                  <div>
                    <label className={labelClass}>Actions</label>
                    <ComboBox value={annValue("actions")} onChange={(v) => saveAnnotation("actions", v)} options={opts.actions || []} placeholder="Running" className={inputClass + " w-full"} />
                  </div>
                  <div>
                    <label className={labelClass}>Shape</label>
                    <ComboBox value={annValue("shape")} onChange={(v) => saveAnnotation("shape", v)} options={SHAPE_OPTIONS} placeholder="upright" className={inputClass + " w-full"} />
                  </div>

                  {/* ── Art Style ── */}
                  <div className="col-span-2 md:col-span-3 flex items-center gap-2 pt-2 mt-1">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Art Style</span>
                    <div className="flex-1 h-px bg-gray-200" />
                  </div>
                  <div>
                    <label className={labelClass}>Art Style</label>
                    <MultiComboBox value={annValue("art_style", true)} onChange={(v) => saveAnnotation("art_style", v)} options={opts.artStyle || []} placeholder="Chibi, Cartoon" />
                  </div>
                  <div>
                    <label className={labelClass}>Camera Angle</label>
                    <ComboBox value={annValue("camera_angle")} onChange={(v) => saveAnnotation("camera_angle", v)} options={opts.cameraAngle || []} placeholder="Front" className={inputClass + " w-full"} />
                  </div>
                  <div>
                    <label className={labelClass}>Perspective</label>
                    <ComboBox value={annValue("perspective")} onChange={(v) => saveAnnotation("perspective", v)} options={opts.perspective || []} placeholder="" className={inputClass + " w-full"} />
                  </div>
                  <div>
                    <label className={labelClass}>Primary Color</label>
                    <ComboBox value={annValue("primary_color")} onChange={(v) => saveAnnotation("primary_color", v)} options={COLOR_OPTIONS} placeholder="Yellow" className={inputClass + " w-full"} />
                  </div>
                  <div>
                    <label className={labelClass}>Secondary Color</label>
                    <ComboBox value={annValue("secondary_color")} onChange={(v) => saveAnnotation("secondary_color", v)} options={COLOR_OPTIONS} placeholder="Brown" className={inputClass + " w-full"} />
                  </div>
                  <div>
                    <label className={labelClass}>Storytelling</label>
                    <ComboBox value={annValue("storytelling")} onChange={(v) => saveAnnotation("storytelling", v)} options={opts.storytelling || []} placeholder="Celebration" className={inputClass + " w-full"} />
                  </div>

                  {/* ── Scene & Setting ── */}
                  <div className="col-span-2 md:col-span-3 flex items-center gap-2 pt-2 mt-1">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Scene & Setting</span>
                    <div className="flex-1 h-px bg-gray-200" />
                  </div>
                  <div>
                    <label className={labelClass}>Card Locations</label>
                    <ComboBox value={annValue("card_locations")} onChange={(v) => saveAnnotation("card_locations", v)} options={opts.cardLocations || []} placeholder="Nagoya" className={inputClass + " w-full"} />
                  </div>
                  <div>
                    <label className={labelClass}>Pokemon Region</label>
                    <ComboBox value={annValue("pkmn_region")} onChange={(v) => saveAnnotation("pkmn_region", v)} options={opts.pkmnRegion || []} placeholder="Johto" className={inputClass + " w-full"} />
                  </div>
                  <div>
                    <label className={labelClass}>Weather/Environment</label>
                    <ComboBox value={annValue("weather_environment")} onChange={(v) => saveAnnotation("weather_environment", v)} options={opts.weatherEnvironment || []} placeholder="Sunny" className={inputClass + " w-full"} />
                  </div>
                  <div>
                    <label className={labelClass}>Background Details</label>
                    <MultiComboBox value={annValue("background_details", true)} onChange={(v) => saveAnnotation("background_details", v)} options={opts.backgroundDetails || []} placeholder="Trees, River" />
                  </div>

                  {/* ── Items ── */}
                  <div className="col-span-2 md:col-span-3 flex items-center gap-2 pt-2 mt-1">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Items</span>
                    <div className="flex-1 h-px bg-gray-200" />
                  </div>
                  <div>
                    <label className={labelClass}>Items</label>
                    <ComboBox value={annValue("items")} onChange={(v) => saveAnnotation("items", v)} options={opts.items || []} placeholder="Poke Ball" className={inputClass + " w-full"} />
                  </div>
                  <div>
                    <label className={labelClass}>Held Item</label>
                    <ComboBox value={annValue("held_item")} onChange={(v) => saveAnnotation("held_item", v)} options={opts.heldItem || HELD_ITEM_OPTIONS} placeholder="Berry" className={inputClass + " w-full"} />
                  </div>
                  <div>
                    <label className={labelClass}>Pokeball</label>
                    <ComboBox value={annValue("pokeball")} onChange={(v) => saveAnnotation("pokeball", v)} options={opts.pokeball || POKEBALL_OPTIONS} placeholder="Great Ball" className={inputClass + " w-full"} />
                  </div>
                  <div>
                    <label className={labelClass}>Evolution Items</label>
                    <MultiComboBox value={annValue("evolution_items", true)} onChange={(v) => saveAnnotation("evolution_items", v)} options={opts.evolutionItems || EVOLUTION_ITEMS_OPTIONS} placeholder="Fire Stone" />
                  </div>
                  <div>
                    <label className={labelClass}>Berries</label>
                    <MultiComboBox value={annValue("berries", true)} onChange={(v) => saveAnnotation("berries", v)} options={opts.berries || BERRIES_OPTIONS} placeholder="Oran Berry" />
                  </div>

                  {/* ── Themes ── */}
                  <div className="col-span-2 md:col-span-3 flex items-center gap-2 pt-2 mt-1">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Themes</span>
                    <div className="flex-1 h-px bg-gray-200" />
                  </div>
                  <div>
                    <label className={labelClass}>Holiday Theme</label>
                    <MultiComboBox value={annValue("holiday_theme", true)} onChange={(v) => saveAnnotation("holiday_theme", v)} options={opts.holidayTheme || HOLIDAY_THEME_OPTIONS} placeholder="Halloween" />
                  </div>
                  <div>
                    <label className={labelClass}>Multi Card</label>
                    <MultiComboBox value={annValue("multi_card", true)} onChange={(v) => saveAnnotation("multi_card", v)} options={opts.multiCard || MULTI_CARD_OPTIONS} placeholder="Storytelling" />
                  </div>

                </div>
              </CollapsibleSection>

              <CollapsibleSection title="Video" defaultOpen={false}>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div>
                    <label className={labelClass}>Video Game</label>
                    <MultiComboBox value={annValue("video_game", true)} onChange={(v) => saveAnnotation("video_game", v)} options={VIDEO_GAME_OPTIONS} placeholder="X/Y" />
                  </div>
                  <div>
                    <label className={labelClass}>Video Game Location</label>
                    <MultiComboBox value={annValue("video_game_location", true)} onChange={(v) => saveAnnotation("video_game_location", v)} options={opts.videoGameLocation || VIDEO_LOCATION_OPTIONS} placeholder="Pallet Town, Route 1" />
                  </div>
                  <div className="flex items-center gap-2 pt-6">
                    <input type="checkbox" id="cardDetail-shortsAppearance" checked={!!ann.shorts_appearance} onChange={(e) => saveAnnotation("shorts_appearance", e.target.checked)} className="rounded" />
                    <label htmlFor="cardDetail-shortsAppearance" className="text-sm text-gray-700">Shorts Appearance</label>
                  </div>
                  <div className="flex items-center gap-2 pt-6">
                    <input type="checkbox" id="cardDetail-regionAppearance" checked={!!ann.region_appearance} onChange={(e) => saveAnnotation("region_appearance", e.target.checked)} className="rounded" />
                    <label htmlFor="cardDetail-regionAppearance" className="text-sm text-gray-700">Region Appearance</label>
                  </div>
                  <div className="flex items-center gap-2 pt-6">
                    <input type="checkbox" id="cardDetail-thumbnailUsed" checked={!!ann.thumbnail_used} onChange={(e) => saveAnnotation("thumbnail_used", e.target.checked)} className="rounded" />
                    <label htmlFor="cardDetail-thumbnailUsed" className="text-sm text-gray-700">Thumbnail Used</label>
                  </div>
                  <div className="col-span-2 md:col-span-3">
                    <label className={labelClass}>Video Title</label>
                    <MultiComboBox value={annValue("video_title", true)} onChange={(v) => saveAnnotation("video_title", v)} options={opts.videoTitle || []} placeholder="Video title" />
                  </div>
                  <div className="col-span-2 md:col-span-3">
                    <label className={labelClass}>Video Type</label>
                    <MultiComboBox value={annValue("video_type", true)} onChange={(v) => saveAnnotation("video_type", v)}
                      options={opts.videoType || VIDEO_TYPE_OPTIONS} placeholder="Top 10, Every Card in a Region" />
                  </div>
                  <div>
                    <label className={labelClass}>Video Region</label>
                    <MultiComboBox value={annValue("video_region", true)} onChange={(v) => saveAnnotation("video_region", v)}
                      options={opts.videoRegion || VIDEO_REGION_OPTIONS} placeholder="Kanto, Johto" />
                  </div>
                  <div>
                    <label className={labelClass}>Top 10 Themes</label>
                    <MultiComboBox value={annValue("top_10_themes", true)} onChange={(v) => saveAnnotation("top_10_themes", v)}
                      options={opts.top10Themes || TOP_10_THEMES_OPTIONS} placeholder="Theme" />
                  </div>
                  <div>
                    <label className={labelClass}>WTPC Episode Number</label>
                    <MultiComboBox value={annValue("wtpc_episode", true)} onChange={(v) => saveAnnotation("wtpc_episode", v)}
                      options={WTPC_EPISODE_OPTIONS} placeholder="Episode 1" />
                  </div>
                  <div>
                    <label className={labelClass}>Video Location</label>
                    <MultiComboBox value={annValue("video_location", true)} onChange={(v) => saveAnnotation("video_location", v)}
                      options={opts.videoLocation || VIDEO_LOCATION_OPTIONS} placeholder="Pallet Town, Lumiose City" />
                  </div>
                </div>
              </CollapsibleSection>

              <CollapsibleSection title="Notes" defaultOpen={false}>
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="cardDetail-owned" checked={!!ann.owned} onChange={(e) => saveAnnotation("owned", e.target.checked)} className="rounded" />
                    <label htmlFor="cardDetail-owned" className="text-sm text-gray-700">Owned</label>
                  </div>
                  <div>
                    <label className={labelClass}>Notes</label>
                    <textarea value={annValue("notes")} onChange={(e) => saveAnnotation("notes", e.target.value)} rows={3} placeholder="Any additional notes..." className={inputClass + " w-full"} />
                  </div>
                </div>
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
            src={parseAnnotations(card).image_override || card.image_large}
            alt={card.name}
            className="max-h-[90vh] max-w-[90vw] object-contain"
            onClick={(e) => e.stopPropagation()}
            onError={(e) => {
              if (card.image_fallback && e.target.src !== card.image_fallback) {
                e.target.src = card.image_fallback;
              }
            }}
          />
        </div>
      )}
    </div>
  );
}
