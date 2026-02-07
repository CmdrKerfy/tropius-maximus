/**
 * AnnotationEditor — Dynamic form for editing per-card annotations.
 *
 * Renders form fields based on the attribute_definitions.
 * Each attribute type maps to a specific widget:
 *   - text     → textarea
 *   - number   → number input (with optional min/max)
 *   - boolean  → checkbox
 *   - select   → dropdown
 *
 * Changes are saved automatically on blur/change via the patch endpoint.
 * The component manages its own local state so edits feel immediate,
 * then syncs in the background.
 */

import { useState, useCallback } from "react";
import { patchAnnotations } from "../db";

export default function AnnotationEditor({ cardId, annotations, attributes }) {
  // Local copy of annotations for immediate UI updates.
  const [values, setValues] = useState(annotations || {});
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);

  // Save a single annotation field.
  const save = useCallback(
    async (key, value) => {
      setSaving(true);
      try {
        const result = await patchAnnotations(cardId, { [key]: value });
        setValues(result);
        setLastSaved(new Date());
      } catch (err) {
        console.error("Failed to save annotation:", err);
      } finally {
        setSaving(false);
      }
    },
    [cardId]
  );

  // Handle changes for each field type.
  const handleChange = (attr, newValue) => {
    setValues((prev) => ({ ...prev, [attr.key]: newValue }));
  };

  const handleBlur = (attr) => {
    save(attr.key, values[attr.key] ?? attr.default_value ?? null);
  };

  const handleImmediateChange = (attr, newValue) => {
    // For checkboxes and selects, save immediately (no blur event needed).
    setValues((prev) => ({ ...prev, [attr.key]: newValue }));
    save(attr.key, newValue);
  };

  // Shared input styling.
  const inputClass =
    "w-full px-3 py-1.5 border border-gray-300 rounded text-sm " +
    "focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent";

  // Filter out unique_id and evolution_line - they're now displayed read-only in CardDetail
  const editableAttrs = attributes.filter(
    (a) => !["unique_id", "evolution_line"].includes(a.key)
  );

  return (
    <div className="space-y-3">
      {editableAttrs.map((attr) => {
        const value = values[attr.key] ?? attr.default_value ?? null;

        return (
          <div key={attr.key}>
            <label className="block text-sm font-medium text-gray-600 mb-1">
              {attr.label}
            </label>

            {/* Text field → textarea */}
            {attr.value_type === "text" && (
              <textarea
                value={value || ""}
                onChange={(e) => handleChange(attr, e.target.value)}
                onBlur={() => handleBlur(attr)}
                rows={2}
                className={inputClass + " resize-y"}
                placeholder={`Enter ${attr.label.toLowerCase()}...`}
              />
            )}

            {/* Number field → number input */}
            {attr.value_type === "number" && (
              <input
                type="number"
                value={value ?? ""}
                min={attr.options?.min}
                max={attr.options?.max}
                onChange={(e) =>
                  handleChange(
                    attr,
                    e.target.value === "" ? null : Number(e.target.value)
                  )
                }
                onBlur={() => handleBlur(attr)}
                className={inputClass + " max-w-[120px]"}
              />
            )}

            {/* Boolean field → checkbox */}
            {attr.value_type === "boolean" && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!value}
                  onChange={(e) =>
                    handleImmediateChange(attr, e.target.checked)
                  }
                  className="w-4 h-4 text-green-600 rounded border-gray-300
                             focus:ring-green-500"
                />
                {value && <span className="text-sm text-green-600 font-medium">Yes</span>}
              </label>
            )}

            {/* Select field → dropdown */}
            {attr.value_type === "select" && (
              <select
                value={value || ""}
                onChange={(e) =>
                  handleImmediateChange(attr, e.target.value || null)
                }
                className={inputClass + " max-w-[200px]"}
              >
                <option value="">Not set</option>
                {(Array.isArray(attr.options) ? attr.options : []).map(
                  (opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  )
                )}
              </select>
            )}
          </div>
        );
      })}

      {/* Save indicator */}
      <div className="text-xs text-gray-400 h-4">
        {saving && "Saving..."}
        {!saving && lastSaved && (
          <span>
            Saved at {lastSaved.toLocaleTimeString()}
          </span>
        )}
      </div>
    </div>
  );
}
