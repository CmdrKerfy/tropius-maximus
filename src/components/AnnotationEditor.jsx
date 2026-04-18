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

import { useState, useCallback, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { patchAnnotations } from "../db";
import { toastError } from "../lib/toast.js";
import { humanizeError } from "../lib/humanizeError.js";

/** Stack marker: field was absent before save (undo → clear). */
const UNDO_ABSENT = Symbol("tm_undo_absent");

function cloneForUndo(val) {
  if (val === null || val === undefined) return val;
  if (typeof val === "object") {
    try {
      return JSON.parse(JSON.stringify(val));
    } catch {
      return val;
    }
  }
  return val;
}
import ComboBox from "./ComboBox";
import MultiComboBox from "./MultiComboBox";
import FormFieldLabel from "./ui/FormFieldLabel.jsx";

/** field_definitions.name (snake_case) → fetchFormOptions() camelCase key. */
const FORM_OPTS_KEY_OVERRIDES = {
  top_10_themes: "top10Themes",
};

function formOptsKeyForAttr(attrKey) {
  if (FORM_OPTS_KEY_OVERRIDES[attrKey]) return FORM_OPTS_KEY_OVERRIDES[attrKey];
  return attrKey.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

/** Curated options from field_definitions (JSONB array or JSON string). */
function curatedToOptions(curated) {
  if (Array.isArray(curated)) return curated;
  if (typeof curated === "string") {
    try {
      const p = JSON.parse(curated);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

function multiValueToComboString(value) {
  if (Array.isArray(value)) return value.join(", ");
  if (value == null || value === "") return "";
  return String(value);
}

function mergedSuggestionOptions(attr, formOptions) {
  const curated = curatedToOptions(attr.options);
  const fk = formOptsKeyForAttr(attr.key);
  const fromForm = Array.isArray(formOptions?.[fk]) ? formOptions[fk] : [];
  const set = new Set(
    [...curated, ...fromForm].filter((x) => x != null && String(x).trim() !== "")
  );
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export default function AnnotationEditor({
  cardId,
  annotations,
  attributes,
  formOptions = {},
  /** Workbench chrome: idle / saving / saved / error (+ optional retry). */
  onSaveStatusChange,
}) {
  const queryClient = useQueryClient();
  // Local copy of annotations for immediate UI updates.
  const [values, setValues] = useState(annotations || {});
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [undoHint, setUndoHint] = useState(null);
  const [undoCount, setUndoCount] = useState(0);

  const serverSnapshotRef = useRef({});
  const undoStackRef = useRef([]);

  const undoShortcut =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent)
      ? "⌘⇧Z"
      : "Ctrl+Shift+Z";

  useEffect(() => {
    onSaveStatusChange?.({ phase: "idle", detail: null, savedAt: null, retry: null });
  }, [cardId, onSaveStatusChange]);

  useEffect(() => {
    const snap = { ...(annotations || {}) };
    serverSnapshotRef.current = snap;
    setValues(snap);
    undoStackRef.current = [];
    setUndoHint(null);
    setUndoCount(0);
  }, [cardId, annotations]);

  const undoLast = useCallback(async () => {
    const stack = undoStackRef.current;
    const item = stack.length ? stack[stack.length - 1] : null;
    if (!item) return;
    const payload =
      item.revertTo === UNDO_ABSENT ? { [item.key]: null } : { [item.key]: item.revertTo };

    const runUndoPatch = async () => {
      onSaveStatusChange?.({ phase: "saving", detail: null, savedAt: null, retry: null });
      setSaving(true);
      setUndoHint(null);
      try {
        const result = await patchAnnotations(cardId, payload);
        setValues(result);
        serverSnapshotRef.current = { ...result };
        undoStackRef.current.pop();
        setLastSaved(new Date());
        setUndoHint(`Restored “${item.key.replace(/_/g, " ")}”`);
        setUndoCount(undoStackRef.current.length);
        queryClient.invalidateQueries({ queryKey: ["editHistory"] });
        onSaveStatusChange?.({ phase: "saved", detail: null, savedAt: new Date(), retry: null });
      } catch (err) {
        console.error("Undo failed:", err);
        toastError(err);
        onSaveStatusChange?.({
          phase: "error",
          detail: humanizeError(err),
          savedAt: null,
          retry: () => {
            void runUndoPatch();
          },
        });
      } finally {
        setSaving(false);
      }
    };

    await runUndoPatch();
  }, [cardId, onSaveStatusChange, queryClient]);

  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return;
      if (e.key !== "z" && e.key !== "Z") return;
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || document.activeElement?.isContentEditable) return;
      if (undoStackRef.current.length === 0) return;
      e.preventDefault();
      undoLast();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undoLast]);

  const persistField = useCallback(
    async (key, value) => {
      onSaveStatusChange?.({ phase: "saving", detail: null, savedAt: null, retry: null });
      setSaving(true);
      setUndoHint(null);
      try {
        const revertTo = Object.prototype.hasOwnProperty.call(serverSnapshotRef.current, key)
          ? cloneForUndo(serverSnapshotRef.current[key])
          : UNDO_ABSENT;
        const result = await patchAnnotations(cardId, { [key]: value });
        setValues(result);
        serverSnapshotRef.current = { ...result };
        undoStackRef.current.push({ key, revertTo });
        if (undoStackRef.current.length > 40) undoStackRef.current.shift();
        setUndoCount(undoStackRef.current.length);
        setLastSaved(new Date());
        queryClient.invalidateQueries({ queryKey: ["editHistory"] });
        onSaveStatusChange?.({ phase: "saved", detail: null, savedAt: new Date(), retry: null });
      } catch (err) {
        console.error("Failed to save annotation:", err);
        toastError(err);
        onSaveStatusChange?.({
          phase: "error",
          detail: humanizeError(err),
          savedAt: null,
          retry: () => {
            void persistField(key, value);
          },
        });
      } finally {
        setSaving(false);
      }
    },
    [cardId, onSaveStatusChange, queryClient]
  );

  // Save a single annotation field.
  const save = useCallback(
    (key, value) => {
      void persistField(key, value);
    },
    [persistField]
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
  // Sort by sort_order to ensure consistent ordering
  const editableAttrs = attributes
    .filter((a) => !["unique_id", "evolution_line"].includes(a.key))
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  return (
    <div className="space-y-3">
      {editableAttrs.map((attr) => {
        const value = values[attr.key] ?? attr.default_value ?? null;
        const mergedOpts = mergedSuggestionOptions(attr, formOptions);
        const textAsCombo = attr.value_type === "text" && mergedOpts.length > 0;

        return (
          <div key={attr.key}>
            <FormFieldLabel className="text-gray-700">{attr.label}</FormFieldLabel>

            {/* Text field → ComboBox when suggestions exist (parity with Card Detail), else textarea */}
            {attr.value_type === "text" && textAsCombo && (
              <ComboBox
                value={value || ""}
                onChange={(v) => handleImmediateChange(attr, v || null)}
                options={mergedOpts}
                placeholder={`Enter ${attr.label.toLowerCase()}...`}
                className={inputClass + " w-full"}
              />
            )}

            {attr.value_type === "text" && !textAsCombo && (
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

            {/* Select → ComboBox with curated + DB usage (same option source as Card Detail) */}
            {attr.value_type === "select" && (
              <ComboBox
                value={value || ""}
                onChange={(v) => handleImmediateChange(attr, v || null)}
                options={mergedOpts}
                placeholder="Not set"
                className={inputClass + " w-full max-w-[min(100%,420px)]"}
              />
            )}

            {/* Multi-select (field_definitions multi_select) → MultiComboBox */}
            {attr.value_type === "multi_select" && (
              <MultiComboBox
                value={multiValueToComboString(value)}
                onChange={(commaStr) => {
                  let arr = commaStr
                    ? commaStr.split(",").map((s) => s.trim()).filter(Boolean)
                    : [];
                  if (attr.key === "background_pokemon") {
                    arr = arr.map((s) => s.toLowerCase());
                  }
                  setValues((prev) => ({ ...prev, [attr.key]: arr }));
                  save(attr.key, arr);
                }}
                options={mergedOpts}
                placeholder={`Add ${attr.label.toLowerCase()}…`}
                className="w-full"
              />
            )}

            {/* URL (image override, video URL, …) */}
            {attr.value_type === "url" && (
              <input
                type="text"
                inputMode="url"
                value={value || ""}
                onChange={(e) => handleChange(attr, e.target.value)}
                onBlur={(e) => {
                  const t = e.target.value.trim();
                  save(attr.key, t || null);
                }}
                className={inputClass}
                placeholder="https://…"
              />
            )}

            {/* Unknown types: still editable as text (avoids blank rows) */}
            {!["text", "number", "boolean", "select", "multi_select", "url"].includes(
              attr.value_type
            ) && (
              <textarea
                value={
                  typeof value === "object" && value !== null
                    ? JSON.stringify(value)
                    : value || ""
                }
                onChange={(e) => {
                  const v = e.target.value;
                  handleChange(attr, v);
                }}
                onBlur={() => {
                  const raw = values[attr.key];
                  if (typeof raw === "string" && raw.trim().startsWith("[")) {
                    try {
                      save(attr.key, JSON.parse(raw));
                      return;
                    } catch {
                      /* keep as string */
                    }
                  }
                  handleBlur(attr);
                }}
                rows={2}
                className={inputClass + " resize-y font-mono text-xs"}
                placeholder={`(${attr.value_type})`}
              />
            )}
          </div>
        );
      })}

      {/* Save indicator */}
      <div className="text-xs text-gray-400 min-h-4 space-y-0.5">
        {saving && <span>Saving…</span>}
        {!saving && undoHint && <span className="text-green-700">{undoHint}</span>}
        {!saving && !undoHint && lastSaved && (
          <span>
            Saved at {lastSaved.toLocaleTimeString()}
            {undoCount > 0 && (
              <span className="text-gray-500">
                {" "}
                · Undo last save: {undoShortcut} (only when focus is outside text fields)
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
