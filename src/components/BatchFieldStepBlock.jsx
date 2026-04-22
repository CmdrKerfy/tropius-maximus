/**
 * One row in the Batch wizard “field & value” step (multi-field capable).
 */

import { buildPatch, formatAnnotationValueForDisplay } from "../lib/batchEditPatch.js";

export function summarizeStepPatch(attr, mode, textValue, boolValue) {
  if (!attr) return "";
  if (mode === "clear") return "Clear (remove value)";
  try {
    const p = buildPatch(attr, mode, textValue, boolValue);
    const v = p[attr.key];
    return formatAnnotationValueForDisplay(v);
  } catch {
    return "—";
  }
}

/**
 * @param {{
 *   step: { id: string, fieldKey: string, mode: string, textValue: string, boolValue: boolean },
 *   stepIndex: number,
 *   stepCount: number,
 *   sortedAttrs: Array<{ key: string, label?: string, is_builtin?: boolean, value_type?: string, options?: unknown }>,
 *   attrPending: boolean,
 *   onChange: (partial: Record<string, unknown>) => void,
 *   onRemove?: () => void,
 * }} props
 */
export default function BatchFieldStepBlock({
  step,
  stepIndex,
  stepCount,
  sortedAttrs,
  attrPending,
  onChange,
  onRemove,
}) {
  const selectedAttr = sortedAttrs.find((a) => a.key === step.fieldKey) || null;
  const selectOptions = Array.isArray(selectedAttr?.options) ? selectedAttr.options.map((opt) => String(opt)) : [];
  const hasSelectOptions =
    selectedAttr?.value_type === "select" &&
    Array.isArray(selectedAttr?.options) &&
    selectedAttr.options.length > 0;
  const hasExplicitCustomSelectValue =
    Boolean(step.textValue) && !selectOptions.some((opt) => opt === String(step.textValue));
  const useCustomSelectValue = Boolean(step.useCustomSelectValue) || hasExplicitCustomSelectValue;
  const showCuratedPromote = Boolean(
    selectedAttr &&
      !selectedAttr.is_builtin &&
      step.mode === "set" &&
      (selectedAttr.value_type === "select" || selectedAttr.value_type === "multi_select")
  );

  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-gray-600">
          Field {stepIndex + 1}
          {stepCount > 1 ? ` of ${stepCount}` : ""}
        </span>
        {stepCount > 1 && stepIndex > 0 && onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            className="text-xs font-medium text-red-700 hover:underline"
          >
            Remove
          </button>
        ) : null}
      </div>

      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Field</label>
        {attrPending ? (
          <p className="text-sm text-gray-500">Loading fields…</p>
        ) : (
          <select
            value={step.fieldKey}
            onChange={(e) => {
              onChange({
                fieldKey: e.target.value,
                textValue: "",
                boolValue: false,
                useCustomSelectValue: false,
              });
            }}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
          >
            <option value="">Select a field…</option>
            {sortedAttrs.map((a) => (
              <option key={a.key} value={a.key}>
                {a.label || a.key}
                {a.is_builtin ? "" : " (custom)"}
              </option>
            ))}
          </select>
        )}
      </div>

      {selectedAttr && (
        <>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name={`batchModeW-${step.id}`}
                checked={step.mode === "set"}
                onChange={() => onChange({ mode: "set" })}
              />
              Set value
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name={`batchModeW-${step.id}`}
                checked={step.mode === "clear"}
                onChange={() => onChange({ mode: "clear", promoteCurated: false })}
              />
              Clear field (remove value)
            </label>
          </div>

          {step.mode === "set" && selectedAttr.value_type === "boolean" && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="rounded"
                checked={step.boolValue}
                onChange={(e) => onChange({ boolValue: e.target.checked })}
              />
              Checked = true, unchecked = false
            </label>
          )}

          {step.mode === "set" && hasSelectOptions && (
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Value</label>
                <label className="mb-2 inline-flex items-center gap-1.5 text-xs text-gray-700">
                  <input
                    type="checkbox"
                    className="rounded"
                    checked={useCustomSelectValue}
                    onChange={(e) =>
                      onChange({
                        useCustomSelectValue: e.target.checked,
                        textValue: e.target.checked ? step.textValue : "",
                      })
                    }
                  />
                  Use custom value
                </label>
                {!useCustomSelectValue ? (
                  <select
                    value={step.textValue}
                    onChange={(e) => onChange({ textValue: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                  >
                    <option value="">—</option>
                    {selectedAttr.options.map((opt) => (
                      <option key={String(opt)} value={String(opt)}>
                        {String(opt)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={step.textValue}
                    onChange={(e) => onChange({ textValue: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    placeholder="Type custom value (e.g. Orange)"
                  />
                )}
              </div>
            )}

          {step.mode === "set" &&
            selectedAttr.value_type !== "boolean" &&
            !(
              hasSelectOptions
            ) && (
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                  {selectedAttr.value_type === "multi_select" ? "Values (comma-separated)" : "Value"}
                </label>
                {selectedAttr.value_type === "number" ? (
                  <input
                    type="text"
                    inputMode="decimal"
                    value={step.textValue}
                    onChange={(e) => onChange({ textValue: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    placeholder="Number"
                  />
                ) : (
                  <textarea
                    value={step.textValue}
                    onChange={(e) => onChange({ textValue: e.target.value })}
                    rows={selectedAttr.value_type === "multi_select" ? 3 : 2}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
                    placeholder={
                      selectedAttr.value_type === "multi_select"
                        ? "e.g. Sunny, Clouds"
                        : "New value for every card in the list"
                    }
                  />
                )}
              </div>
            )}

          {showCuratedPromote ? (
            <label className="flex items-start gap-2 text-sm text-gray-800 border border-gray-100 rounded-lg px-3 py-2 bg-white/80">
              <input
                type="checkbox"
                className="mt-0.5 rounded"
                checked={Boolean(step.promoteCurated)}
                onChange={(e) => onChange({ promoteCurated: e.target.checked })}
              />
              <span>
                Also add this value to <strong>curated options</strong> for this field (custom select / multi-select
                only).
              </span>
            </label>
          ) : null}
        </>
      )}
    </div>
  );
}
