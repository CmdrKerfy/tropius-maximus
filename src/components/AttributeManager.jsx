/**
 * AttributeManager — Settings panel to create and delete custom attributes.
 *
 * Users can add new annotation fields (e.g., "tier", "trade_value") that
 * will appear in the AnnotationEditor for every card. Each attribute needs
 * a key, label, and type. Select-type attributes also need a list of options.
 *
 * Built-in attributes (notes, rating, condition, owned) cannot be deleted.
 */

import { useState } from "react";
import { createAttribute, deleteAttribute } from "../db";

export default function AttributeManager({ attributes, onChanged }) {
  // Form state for creating a new attribute.
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [valueType, setValueType] = useState("text");
  const [optionsText, setOptionsText] = useState("");
  const [numberMin, setNumberMin] = useState("");
  const [numberMax, setNumberMax] = useState("");
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);

  const handleCreate = async (e) => {
    e.preventDefault();
    setError(null);
    setCreating(true);

    try {
      // Build the options field based on the value type.
      let options = null;
      if (valueType === "select") {
        // Parse comma-separated options.
        options = optionsText
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (options.length < 2) {
          throw new Error("Select attributes need at least 2 options");
        }
      } else if (valueType === "number") {
        // Build min/max object if provided.
        const numOpts = {};
        if (numberMin !== "") numOpts.min = Number(numberMin);
        if (numberMax !== "") numOpts.max = Number(numberMax);
        if (Object.keys(numOpts).length > 0) options = numOpts;
      }

      await createAttribute({
        key: key.toLowerCase().replace(/\s+/g, "_"),
        label,
        value_type: valueType,
        options,
        default_value: null,
      });

      // Reset form and refresh the attribute list.
      setKey("");
      setLabel("");
      setValueType("text");
      setOptionsText("");
      setNumberMin("");
      setNumberMax("");
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (attrKey) => {
    if (!confirm(`Delete custom attribute "${attrKey}"?`)) return;
    try {
      await deleteAttribute(attrKey);
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  };

  const inputClass =
    "px-3 py-1.5 border border-gray-300 rounded text-sm " +
    "focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent";

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
      <h2 className="font-semibold text-gray-800 mb-3">
        Custom Attribute Manager
      </h2>

      {/* Existing attributes list */}
      <div className="mb-4">
        <h3 className="text-sm font-medium text-gray-600 mb-2">
          Current Attributes
        </h3>
        <div className="space-y-1">
          {attributes.map((attr) => (
            <div
              key={attr.key}
              className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-gray-50"
            >
              <div className="text-sm">
                <span className="font-medium text-gray-800">
                  {attr.label}
                </span>
                <span className="text-gray-400 ml-2">({attr.value_type})</span>
                {attr.is_builtin && (
                  <span className="text-xs text-gray-400 ml-2">
                    built-in
                  </span>
                )}
              </div>
              {!attr.is_builtin && (
                <button
                  onClick={() => handleDelete(attr.key)}
                  className="text-green-500 hover:text-green-700 text-sm transition-colors"
                >
                  Delete
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Create new attribute form */}
      <div className="border-t pt-4">
        <h3 className="text-sm font-medium text-gray-600 mb-2">
          Add New Attribute
        </h3>

        {error && (
          <div className="text-green-500 text-sm mb-2">{error}</div>
        )}

        <form onSubmit={handleCreate} className="space-y-3">
          <div className="flex flex-wrap gap-3">
            <input
              type="text"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Key (e.g. tier)"
              required
              pattern="[a-z0-9_]+"
              title="Lowercase letters, numbers, and underscores only"
              className={inputClass + " w-36"}
            />
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Display label"
              required
              className={inputClass + " w-44"}
            />
            <select
              value={valueType}
              onChange={(e) => setValueType(e.target.value)}
              className={inputClass}
            >
              <option value="text">Text</option>
              <option value="number">Number</option>
              <option value="boolean">Boolean</option>
              <option value="select">Select</option>
            </select>
          </div>

          {/* Additional fields based on type */}
          {valueType === "select" && (
            <input
              type="text"
              value={optionsText}
              onChange={(e) => setOptionsText(e.target.value)}
              placeholder="Options (comma-separated, e.g. S,A,B,C,D)"
              required
              className={inputClass + " w-full"}
            />
          )}

          {valueType === "number" && (
            <div className="flex gap-2">
              <input
                type="number"
                value={numberMin}
                onChange={(e) => setNumberMin(e.target.value)}
                placeholder="Min"
                className={inputClass + " w-24"}
              />
              <input
                type="number"
                value={numberMax}
                onChange={(e) => setNumberMax(e.target.value)}
                placeholder="Max"
                className={inputClass + " w-24"}
              />
            </div>
          )}

          <button
            type="submit"
            disabled={creating}
            className="px-4 py-1.5 bg-green-600 text-white rounded text-sm font-medium
                       hover:bg-green-700 disabled:bg-gray-400 transition-colors"
          >
            {creating ? "Creating..." : "Add Attribute"}
          </button>
        </form>
      </div>
    </div>
  );
}
