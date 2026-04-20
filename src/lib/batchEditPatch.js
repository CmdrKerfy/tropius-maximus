/**
 * Shared helpers for Batch edit (URL-scoped legacy + saved-list wizard).
 */

export function parseMultiValue(raw) {
  if (raw == null || String(raw).trim() === "") return [];
  return String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const MAX_FIELD_STEPS = 5;

export { MAX_FIELD_STEPS };

/**
 * Merge multiple field steps into one annotation patch (later keys override if duplicated — UI prevents dupes).
 * @param {Array<{ key?: string, label?: string, value_type?: string, is_builtin?: boolean, options?: unknown }>} attributes
 * @param {Array<{ fieldKey: string, mode: string, textValue: string, boolValue: boolean }>} fieldSteps
 */
export function mergeFieldStepsToPatch(attributes, fieldSteps) {
  const merged = {};
  for (const step of fieldSteps) {
    const attr = attributes.find((a) => a.key === step.fieldKey);
    if (!attr) continue;
    Object.assign(merged, buildPatch(attr, step.mode, step.textValue, step.boolValue));
  }
  return merged;
}

/** True when every non-empty field key is unique across steps. */
export function fieldStepKeysUnique(fieldSteps) {
  const keys = fieldSteps.map((s) => s.fieldKey).filter(Boolean);
  return new Set(keys).size === keys.length;
}

export function buildPatch(attr, mode, textValue, boolValue) {
  const key = attr.key;
  if (mode === "clear") return { [key]: null };

  switch (attr.value_type) {
    case "boolean":
      return { [key]: boolValue };
    case "number": {
      const t = String(textValue ?? "").trim();
      if (t === "") return { [key]: null };
      const n = Number(t);
      if (Number.isNaN(n)) throw new Error("Enter a valid number or clear the field.");
      return { [key]: n };
    }
    case "multi_select":
      return { [key]: parseMultiValue(textValue) };
    case "select":
    case "text":
    case "url":
    default: {
      const t = String(textValue ?? "").trim();
      return { [key]: t === "" ? null : t };
    }
  }
}

/** True if an annotation value counts as “existing” for overwrite preview. */
export function hasMeaningfulAnnotationValue(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === "string" && v.trim() === "") return false;
  if (Array.isArray(v) && v.length === 0) return false;
  return true;
}

export function formatAnnotationValueForDisplay(v) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/**
 * Strings to merge into `field_definitions.curated_options` for a custom select / multi_select batch run.
 * @returns {string[]}
 */
export function curatedPromotionStringsFromInputs(attr, mode, textValue, boolValue) {
  if (!attr || mode !== "set") return [];
  if (attr.value_type !== "select" && attr.value_type !== "multi_select") return [];
  try {
    const patch = buildPatch(attr, mode, textValue, boolValue);
    const v = patch[attr.key];
    if (v === null || v === undefined) return [];
    if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
    const s = String(v).trim();
    return s ? [s] : [];
  } catch {
    return [];
  }
}
