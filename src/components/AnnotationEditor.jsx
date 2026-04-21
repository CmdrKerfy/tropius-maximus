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

import { memo, useState, useCallback, useRef, useEffect, useMemo, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { patchAnnotations, fetchAnnotations, FORM_OPTIONS_QUERY_KEY } from "../db";
import { toastError } from "../lib/toast.js";
import { humanizeError } from "../lib/humanizeError.js";
import { normalizeEvolutionLineOptions } from "../lib/evolutionLineFormat.js";
import { shouldRefreshFormOptionsForAnnotationKey } from "../lib/formOptionsRefreshKeys.js";
import { CARD_DETAIL_PIN_GROUPS } from "../lib/cardDetailPinRegistry.js";
import ComboBox from "./ComboBox";
import MultiComboBox from "./MultiComboBox";
import FormFieldLabel from "./ui/FormFieldLabel.jsx";

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

function valuesEqualForSave(a, b) {
  if (Object.is(a, b)) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a === "object" || typeof b === "object") {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}

/** field_definitions.name (snake_case) → fetchFormOptions() camelCase key. */
const FORM_OPTS_KEY_OVERRIDES = {
  top_10_themes: "top10Themes",
};

const SECTION_STATE_LS_KEY = "tm_workbench_section_open_state_v1";

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
  if (attr.key === "evolution_line") {
    return normalizeEvolutionLineOptions([...curated, ...fromForm]);
  }
  const set = new Set(
    [...curated, ...fromForm].filter((x) => x != null && String(x).trim() !== "")
  );
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function findScrollParent(el) {
  if (!el) return null;
  let cur = el.parentElement;
  while (cur) {
    let style;
    try {
      style = window.getComputedStyle(cur);
    } catch {
      return null;
    }
    const y = style.overflowY;
    if (y === "auto" || y === "scroll") return cur;
    cur = cur.parentElement;
  }
  return null;
}

function AnnotationEditor({
  cardId,
  annotations,
  attributes,
  formOptions = {},
  pinnedKeys = [],
  density = "comfortable",
  /** Workbench chrome: idle / saving / saved / error (+ optional retry). */
  onSaveStatusChange,
}) {
  const compact = density === "compact";
  const queryClient = useQueryClient();
  // Local copy of annotations for immediate UI updates.
  const [values, setValues] = useState(annotations || {});
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [undoHint, setUndoHint] = useState(null);
  const [undoCount, setUndoCount] = useState(0);
  const [activeSectionId, setActiveSectionId] = useState(null);
  const [sectionOpen, setSectionOpen] = useState(() => {
    try {
      if (typeof localStorage === "undefined") return {};
      const raw = localStorage.getItem(SECTION_STATE_LS_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  });
  const [, startSectionTransition] = useTransition();

  const serverSnapshotRef = useRef({});
  const undoStackRef = useRef([]);
  const sectionRefs = useRef({});

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

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        if (typeof localStorage === "undefined") return;
        localStorage.setItem(SECTION_STATE_LS_KEY, JSON.stringify(sectionOpen));
      } catch {
        /* ignore */
      }
    }, 140);
    return () => clearTimeout(timer);
  }, [sectionOpen]);

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
        if (shouldRefreshFormOptionsForAnnotationKey(item.key)) {
          queryClient.invalidateQueries({ queryKey: FORM_OPTIONS_QUERY_KEY });
        }
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
      if (valuesEqualForSave(serverSnapshotRef.current[key], value)) {
        setUndoHint("No changes to save");
        onSaveStatusChange?.({
          phase: "noop",
          detail: "No changes",
          savedAt: null,
          retry: null,
        });
        return;
      }
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
        if (shouldRefreshFormOptionsForAnnotationKey(key)) {
          queryClient.invalidateQueries({ queryKey: FORM_OPTIONS_QUERY_KEY });
        }
        onSaveStatusChange?.({ phase: "saved", detail: null, savedAt: new Date(), retry: null });
      } catch (err) {
        console.error("Failed to save annotation:", err);
        toastError(err);
        const msg = String(err?.message ?? err ?? "");
        if (/ANNOTATION_VERSION_CONFLICT/i.test(msg)) {
          void (async () => {
            try {
              const fresh = await fetchAnnotations(cardId);
              setValues(fresh);
              serverSnapshotRef.current = { ...fresh };
            } catch {
              setValues((prev) => {
                const next = { ...prev };
                if (!Object.prototype.hasOwnProperty.call(serverSnapshotRef.current, key)) {
                  delete next[key];
                } else {
                  next[key] = cloneForUndo(serverSnapshotRef.current[key]);
                }
                return next;
              });
            }
          })();
        } else {
          setValues((prev) => {
            const next = { ...prev };
            if (!Object.prototype.hasOwnProperty.call(serverSnapshotRef.current, key)) {
              delete next[key];
            } else {
              next[key] = cloneForUndo(serverSnapshotRef.current[key]);
            }
            return next;
          });
        }
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
    `w-full ${compact ? "px-2.5 py-1 text-[13px]" : "px-3 py-1.5 text-sm"} border border-gray-300 rounded ` +
    "focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent";

  // Filter out unique_id and evolution_line - they're now displayed read-only in CardDetail
  // Sort by sort_order to ensure consistent ordering
  const editableAttrs = useMemo(
    () =>
      attributes
        .filter((a) => !["unique_id", "evolution_line"].includes(a.key))
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [attributes]
  );
  const pinnedKeySet = useMemo(
    () => new Set(Array.isArray(pinnedKeys) ? pinnedKeys : []),
    [pinnedKeys]
  );
  const pinnedAttrs = useMemo(
    () => editableAttrs.filter((a) => pinnedKeySet.has(a.key)),
    [editableAttrs, pinnedKeySet]
  );
  const remainingAttrs = useMemo(
    () => editableAttrs.filter((a) => !pinnedKeySet.has(a.key)),
    [editableAttrs, pinnedKeySet]
  );
  const attrByKey = useMemo(
    () => new Map(remainingAttrs.map((attr) => [attr.key, attr])),
    [remainingAttrs]
  );
  const sectionDefs = useMemo(() => {
    const defs = [];
    const assigned = new Set();
    for (const group of CARD_DETAIL_PIN_GROUPS) {
      const attrsForGroup = group.keys
        .map((k) => attrByKey.get(k))
        .filter(Boolean);
      if (attrsForGroup.length === 0) continue;
      attrsForGroup.forEach((a) => assigned.add(a.key));
      defs.push({ id: group.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"), title: group.title, attrs: attrsForGroup });
    }
    const customAttrs = remainingAttrs.filter((a) => !assigned.has(a.key));
    if (customAttrs.length > 0) {
      defs.push({ id: "custom-fields", title: "Custom fields", attrs: customAttrs });
    }
    return defs;
  }, [attrByKey, remainingAttrs]);

  useEffect(() => {
    const ids = [
      ...(pinnedAttrs.length > 0 ? ["pinned-fields"] : []),
      ...sectionDefs.map((s) => s.id),
    ];
    if (!ids.length) {
      setActiveSectionId(null);
      return;
    }
    if (!activeSectionId || !ids.includes(activeSectionId)) {
      setActiveSectionId(ids[0]);
    }
  }, [pinnedAttrs.length, sectionDefs, activeSectionId]);

  // Keep jump toolbar responsive: avoid live IntersectionObserver tracking here.
  // Active section still updates when users click jump buttons.

  const isWideField = (attr, textAsCombo) => {
    if (attr.key === "notes") return true;
    if (attr.key === "set_name") return true;
    if (attr.value_type === "multi_select" || attr.value_type === "url") return true;
    if (attr.value_type === "text" && !textAsCombo) return true;
    return false;
  };

  const renderAttrControl = (attr, keyPrefix = "") => {
    const value = values[attr.key] ?? attr.default_value ?? null;
    const mergedOpts = mergedSuggestionOptions(attr, formOptions);
    const textAsCombo = attr.value_type === "text" && mergedOpts.length > 0;
    const wide = isWideField(attr, textAsCombo);

    return (
      <div key={`${keyPrefix}${attr.key}`} className={wide ? "md:col-span-2" : ""}>
        <FormFieldLabel className="text-gray-700">{attr.label}</FormFieldLabel>

        {/* Text field -> ComboBox when suggestions exist (parity with Card Detail), else textarea */}
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

        {/* Number field -> number input */}
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

        {/* Boolean field -> checkbox */}
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

        {/* Select -> ComboBox with curated + DB usage (same option source as Card Detail) */}
        {attr.value_type === "select" && (
          <ComboBox
            value={value || ""}
            onChange={(v) => handleImmediateChange(attr, v || null)}
            options={mergedOpts}
            placeholder="Not set"
            className={inputClass + " w-full max-w-[min(100%,420px)]"}
          />
        )}

        {/* Multi-select (field_definitions multi_select) -> MultiComboBox */}
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

        {/* URL (image override, video URL, ...) */}
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
  };

  const sectionIsOpen = (id) => sectionOpen[id] !== false;
  const toggleSection = (id) => {
    startSectionTransition(() => {
      setSectionOpen((prev) => ({ ...prev, [id]: prev[id] === false }));
    });
  };
  const jumpToSection = (id) => {
    setActiveSectionId(id);
    if (!sectionIsOpen(id)) {
      startSectionTransition(() => {
        setSectionOpen((prev) => ({ ...prev, [id]: true }));
      });
    }
    requestAnimationFrame(() => {
      sectionRefs.current[id]?.scrollIntoView({ behavior: "auto", block: "start" });
    });
  };

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      {(pinnedAttrs.length > 0 || sectionDefs.length > 0) && (
        <div className={`sticky top-0 z-20 rounded-lg border border-gray-200 bg-white ${compact ? "p-1.5" : "p-2"} shadow-sm`}>
          <div className="flex flex-wrap gap-1.5">
            {pinnedAttrs.length > 0 && (
              <button
                type="button"
                onClick={() => jumpToSection("pinned-fields")}
                className={`px-2 py-1 rounded-full text-xs font-medium border transition-colors ${
                  activeSectionId === "pinned-fields"
                    ? "border-tm-leaf/40 bg-tm-cream text-gray-900"
                    : "border-tm-leaf/30 bg-tm-cream/60 text-gray-700 hover:bg-tm-cream"
                }`}
              >
                Pinned
              </button>
            )}
            {sectionDefs.map((s) => (
              <button
                key={`jump-${s.id}`}
                type="button"
                onClick={() => jumpToSection(s.id)}
                className={`px-2 py-1 rounded-full text-xs font-medium border transition-colors ${
                  activeSectionId === s.id
                    ? "border-green-300 bg-green-50 text-green-800"
                    : "border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100"
                }`}
              >
                {s.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {pinnedAttrs.length > 0 && (
        <div
          ref={(el) => {
            sectionRefs.current["pinned-fields"] = el;
          }}
          data-section-id="pinned-fields"
          className={`rounded-lg border border-tm-leaf/25 bg-tm-cream/60 ${compact ? "p-2 space-y-2" : "p-3 space-y-3"}`}
        >
          <button
            type="button"
            onClick={() => toggleSection("pinned-fields")}
            className="w-full flex items-center justify-between text-left"
          >
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-600">Pinned fields</span>
            <span className="text-xs text-gray-500">{sectionIsOpen("pinned-fields") ? "Hide" : "Show"}</span>
          </button>
          {sectionIsOpen("pinned-fields") && (
            <div className={`grid grid-cols-1 md:grid-cols-2 ${compact ? "gap-2" : "gap-3"}`}>
              {pinnedAttrs.map((attr) => renderAttrControl(attr, "pin-"))}
            </div>
          )}
        </div>
      )}

      {sectionDefs.map((section) => (
        <div
          key={section.id}
          ref={(el) => {
            sectionRefs.current[section.id] = el;
          }}
          data-section-id={section.id}
          className={`rounded-lg border border-gray-200 bg-white ${compact ? "p-2 space-y-2" : "p-3 space-y-3"}`}
        >
          <button
            type="button"
            onClick={() => toggleSection(section.id)}
            className="w-full flex items-center justify-between text-left"
          >
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-600">{section.title}</span>
            <span className="text-xs text-gray-500">{sectionIsOpen(section.id) ? "Hide" : "Show"}</span>
          </button>
          {sectionIsOpen(section.id) && (
            <div className={`grid grid-cols-1 md:grid-cols-2 ${compact ? "gap-2" : "gap-3"}`}>
              {section.attrs.map((attr) => renderAttrControl(attr))}
            </div>
          )}
        </div>
      ))}

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

export default memo(AnnotationEditor);
