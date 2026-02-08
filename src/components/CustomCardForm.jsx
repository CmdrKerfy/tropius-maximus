/**
 * CustomCardForm — Form to add custom cards (Japan exclusives, promos, etc.)
 *
 * Custom cards use a reserved set_id prefix ("custom-*") so they won't be
 * overwritten by future ingestion runs from the official Pokemon TCG API.
 */

import { useState } from "react";
import { addCustomCard } from "../db";

export default function CustomCardForm({ onCardAdded, onClose }) {
  // Required fields
  const [cardId, setCardId] = useState("");
  const [cardName, setCardName] = useState("");
  const [setId, setSetId] = useState("custom-");
  const [setDisplayName, setSetDisplayName] = useState("");
  const [imageUrl, setImageUrl] = useState("");

  // Optional fields
  const [supertype, setSupertype] = useState("Pokemon");
  const [types, setTypes] = useState("");
  const [hp, setHp] = useState("");
  const [rarity, setRarity] = useState("");
  const [artist, setArtist] = useState("");
  const [number, setNumber] = useState("");

  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [imageError, setImageError] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setCreating(true);

    try {
      // Validate set_id prefix
      if (!setId.startsWith("custom-")) {
        throw new Error("Set ID must start with 'custom-'");
      }

      if (setId === "custom-") {
        throw new Error("Please provide a set ID after 'custom-'");
      }

      await addCustomCard({
        card_id: cardId,
        name: cardName,
        set_id: setId,
        set_name: setDisplayName || setId.replace("custom-", "").replace(/-/g, " "),
        image_url: imageUrl,
        supertype,
        types: types || null,
        hp: hp || null,
        rarity: rarity || null,
        artist: artist || null,
        number: number || null,
      });

      // Reset form
      setCardId("");
      setCardName("");
      setSetId("custom-");
      setSetDisplayName("");
      setImageUrl("");
      setSupertype("Pokemon");
      setTypes("");
      setHp("");
      setRarity("");
      setArtist("");
      setNumber("");
      setImageError(false);

      // Notify parent
      onCardAdded?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const inputClass =
    "px-3 py-1.5 border border-gray-300 rounded text-sm " +
    "focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent";

  const labelClass = "block text-sm font-medium text-gray-700 mb-1";

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-gray-800">Add Custom Card</h2>
        {onClose && (
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            &times;
          </button>
        )}
      </div>

      <p className="text-sm text-gray-600 mb-4">
        Add cards that don't exist in the official Pokemon TCG API (Japan
        exclusives, promos, etc.). Custom cards use a "custom-" prefix and won't
        be affected by data updates.
      </p>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm mb-4">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Required Fields */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>
              Card ID <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={cardId}
              onChange={(e) => setCardId(e.target.value)}
              placeholder="e.g., pikachu-001"
              required
              pattern="[a-z0-9-]+"
              title="Lowercase letters, numbers, and hyphens only"
              className={inputClass + " w-full"}
            />
            <p className="text-xs text-gray-500 mt-1">
              Full ID will be: {setId}-{cardId || "..."}
            </p>
          </div>

          <div>
            <label className={labelClass}>
              Card Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={cardName}
              onChange={(e) => setCardName(e.target.value)}
              placeholder="e.g., Pikachu"
              required
              className={inputClass + " w-full"}
            />
          </div>

          <div>
            <label className={labelClass}>
              Set ID <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={setId}
              onChange={(e) => {
                let val = e.target.value;
                // Ensure it always starts with custom-
                if (!val.startsWith("custom-")) {
                  val = "custom-" + val.replace(/^custom-?/, "");
                }
                setSetId(val.toLowerCase());
              }}
              placeholder="custom-jp-promos"
              required
              className={inputClass + " w-full"}
            />
            <p className="text-xs text-gray-500 mt-1">
              Must start with "custom-"
            </p>
          </div>

          <div>
            <label className={labelClass}>Set Name</label>
            <input
              type="text"
              value={setDisplayName}
              onChange={(e) => setSetDisplayName(e.target.value)}
              placeholder="e.g., Japan Promos"
              className={inputClass + " w-full"}
            />
          </div>
        </div>

        <div>
          <label className={labelClass}>
            Image URL <span className="text-red-500">*</span>
          </label>
          <input
            type="url"
            value={imageUrl}
            onChange={(e) => {
              setImageUrl(e.target.value);
              setImageError(false);
            }}
            placeholder="https://..."
            required
            className={inputClass + " w-full"}
          />
        </div>

        {/* Image Preview */}
        {imageUrl && (
          <div className="flex justify-center">
            <div className="w-48 h-auto">
              {!imageError ? (
                <img
                  src={imageUrl}
                  alt="Card preview"
                  className="w-full h-auto rounded shadow-md"
                  onError={() => setImageError(true)}
                />
              ) : (
                <div className="w-full h-64 bg-gray-100 rounded flex items-center justify-center text-gray-500 text-sm">
                  Failed to load image
                </div>
              )}
            </div>
          </div>
        )}

        {/* Optional Fields */}
        <div className="border-t pt-4">
          <h3 className="text-sm font-medium text-gray-600 mb-3">
            Optional Details
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <label className={labelClass}>Supertype</label>
              <select
                value={supertype}
                onChange={(e) => setSupertype(e.target.value)}
                className={inputClass + " w-full"}
              >
                <option value="Pokemon">Pokemon</option>
                <option value="Trainer">Trainer</option>
                <option value="Energy">Energy</option>
              </select>
            </div>

            <div>
              <label className={labelClass}>Type</label>
              <select
                value={types}
                onChange={(e) => setTypes(e.target.value)}
                className={inputClass + " w-full"}
              >
                <option value="">None</option>
                <option value="Colorless">Colorless</option>
                <option value="Darkness">Darkness</option>
                <option value="Dragon">Dragon</option>
                <option value="Fairy">Fairy</option>
                <option value="Fighting">Fighting</option>
                <option value="Fire">Fire</option>
                <option value="Grass">Grass</option>
                <option value="Lightning">Lightning</option>
                <option value="Metal">Metal</option>
                <option value="Psychic">Psychic</option>
                <option value="Water">Water</option>
              </select>
            </div>

            <div>
              <label className={labelClass}>HP</label>
              <input
                type="text"
                value={hp}
                onChange={(e) => setHp(e.target.value)}
                placeholder="e.g., 60"
                className={inputClass + " w-full"}
              />
            </div>

            <div>
              <label className={labelClass}>Rarity</label>
              <input
                type="text"
                value={rarity}
                onChange={(e) => setRarity(e.target.value)}
                placeholder="e.g., Promo"
                className={inputClass + " w-full"}
              />
            </div>

            <div>
              <label className={labelClass}>Artist</label>
              <input
                type="text"
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
                placeholder="e.g., Ken Sugimori"
                className={inputClass + " w-full"}
              />
            </div>

            <div>
              <label className={labelClass}>Number</label>
              <input
                type="text"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                placeholder="e.g., 001/100"
                className={inputClass + " w-full"}
              />
            </div>
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={creating}
            className="px-4 py-2 bg-green-600 text-white rounded text-sm font-medium
                       hover:bg-green-700 disabled:bg-gray-400 transition-colors"
          >
            {creating ? "Adding..." : "Add Card"}
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded text-sm font-medium
                         hover:bg-gray-300 transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
