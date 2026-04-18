/**
 * Modal: grouped multi-select (up to max) + explicit pin order (B).
 */

import { useState, useEffect } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "./ui/Dialog.jsx";
import Button from "./ui/Button.jsx";
import {
  CARD_DETAIL_PIN_GROUPS,
  CARD_DETAIL_PIN_LABELS,
  CARD_DETAIL_PIN_MAX,
  normalizeCardDetailPins,
} from "../lib/cardDetailPinRegistry.js";

export default function CardDetailPinEditor({ open, onOpenChange, initialPins, onSave, isSaving }) {
  const [orderedKeys, setOrderedKeys] = useState([]);

  useEffect(() => {
    if (open) {
      setOrderedKeys(normalizeCardDetailPins(initialPins));
    }
  }, [open, initialPins]);

  const atMax = orderedKeys.length >= CARD_DETAIL_PIN_MAX;

  const toggleKey = (key) => {
    setOrderedKeys((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key);
      if (prev.length >= CARD_DETAIL_PIN_MAX) return prev;
      return [...prev, key];
    });
  };

  const move = (index, dir) => {
    setOrderedKeys((prev) => {
      const next = [...prev];
      const j = index + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  };

  const removeKey = (key) => {
    setOrderedKeys((prev) => prev.filter((k) => k !== key));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="fixed left-1/2 top-1/2 max-w-2xl w-[min(100%-1rem,42rem)] max-h-[90vh] -translate-x-1/2 -translate-y-1/2 overflow-hidden flex flex-col rounded-xl border border-gray-200 bg-white p-0 shadow-xl">
        <div className="flex items-start justify-between gap-2 px-5 pt-5 pb-2 shrink-0 border-b border-gray-100">
          <DialogTitle className="text-lg font-semibold text-gray-900 pr-8">Pinned annotation fields</DialogTitle>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"
            aria-label="Close"
          >
            <X className="h-5 w-5" strokeWidth={2} />
          </button>
        </div>

        <div className="px-5 py-3 text-sm text-gray-600 shrink-0">
          Select fields below (groups match <strong>More Info</strong> layout), then set the order they appear in the pin
          strip. Up to <strong>{CARD_DETAIL_PIN_MAX}</strong> fields. The same editors appear in the sections below.
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-4 space-y-5">
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Pin order</h3>
            {orderedKeys.length === 0 ? (
              <p className="text-sm text-gray-500 italic py-2">No fields pinned yet — choose checkboxes in the groups below.</p>
            ) : (
              <ul className="space-y-1.5">
                {orderedKeys.map((key, i) => (
                  <li
                    key={key}
                    className="flex items-center gap-2 rounded-lg border border-tm-leaf/20 bg-tm-cream/50 px-2 py-1.5 text-sm"
                  >
                    <span className="tabular-nums text-xs text-gray-400 w-5 shrink-0">{i + 1}.</span>
                    <span className="flex-1 min-w-0 truncate font-medium text-gray-800">
                      {CARD_DETAIL_PIN_LABELS[key] || key}
                    </span>
                    <button
                      type="button"
                      className="p-1 rounded text-gray-500 hover:bg-white disabled:opacity-30"
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                      aria-label="Move up"
                    >
                      <ChevronUp className="h-4 w-4" strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      className="p-1 rounded text-gray-500 hover:bg-white disabled:opacity-30"
                      disabled={i === orderedKeys.length - 1}
                      onClick={() => move(i, 1)}
                      aria-label="Move down"
                    >
                      <ChevronDown className="h-4 w-4" strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      className="p-1 rounded text-red-600 hover:bg-red-50"
                      onClick={() => removeKey(key)}
                      aria-label={`Remove ${key}`}
                    >
                      <X className="h-4 w-4" strokeWidth={2} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-gray-500 mt-2">
              {orderedKeys.length} / {CARD_DETAIL_PIN_MAX} selected
              {atMax ? " — uncheck a field or remove one to add another." : ""}
            </p>
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">Choose fields (by group)</h3>
            <div className="space-y-4">
              {CARD_DETAIL_PIN_GROUPS.map((group) => (
                <div key={group.title}>
                  <div className="text-xs font-semibold text-gray-700 mb-2 border-b border-gray-100 pb-1">
                    {group.title}
                  </div>
                  <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
                    {group.keys.map((key) => {
                      const checked = orderedKeys.includes(key);
                      const disabled = !checked && atMax;
                      return (
                        <li key={key}>
                          <label
                            className={`flex items-start gap-2 cursor-pointer text-sm rounded-md px-1 py-0.5 -mx-1 hover:bg-gray-50 ${
                              disabled ? "opacity-50 cursor-not-allowed" : ""
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="mt-0.5 rounded border-gray-300 shrink-0"
                              checked={checked}
                              disabled={disabled}
                              onChange={() => toggleKey(key)}
                            />
                            <span className="text-gray-800 leading-snug">{CARD_DETAIL_PIN_LABELS[key] || key}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="flex flex-wrap justify-end gap-2 px-5 py-4 border-t border-gray-100 shrink-0 bg-gray-50/80">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={() => onSave(orderedKeys)} disabled={isSaving}>
            {isSaving ? "Saving…" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
