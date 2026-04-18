/**
 * Modal to choose ordered annotation fields for Card detail pins.
 */

import { useState, useEffect } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "./ui/Dialog.jsx";
import Button from "./ui/Button.jsx";
import { CARD_DETAIL_PINNABLE_KEYS, CARD_DETAIL_PIN_LABELS } from "./CardDetailFieldControl.jsx";

const MAX_PINS = 12;

export default function CardDetailPinEditor({ open, onOpenChange, initialPins, onSave, isSaving }) {
  const [orderedKeys, setOrderedKeys] = useState([]);

  useEffect(() => {
    if (open) {
      const allowed = new Set(CARD_DETAIL_PINNABLE_KEYS);
      setOrderedKeys(
        (Array.isArray(initialPins) ? initialPins : [])
          .map((k) => String(k || "").trim())
          .filter((k) => allowed.has(k))
          .filter((k, i, a) => a.indexOf(k) === i)
          .slice(0, MAX_PINS)
      );
    }
  }, [open, initialPins]);

  const addKey = (key) => {
    if (!key || orderedKeys.includes(key) || orderedKeys.length >= MAX_PINS) return;
    setOrderedKeys((prev) => [...prev, key]);
  };

  const removeKey = (key) => {
    setOrderedKeys((prev) => prev.filter((k) => k !== key));
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

  const availableToAdd = CARD_DETAIL_PINNABLE_KEYS.filter((k) => !orderedKeys.includes(k));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="fixed left-1/2 top-1/2 max-w-md w-[min(100%-1.5rem,28rem)] max-h-[85vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-gray-200 p-5 shadow-xl">
        <div className="flex items-start justify-between gap-2 mb-3">
          <DialogTitle className="text-lg font-semibold text-gray-900">Pinned annotation fields</DialogTitle>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"
            aria-label="Close"
          >
            <X className="h-5 w-5" strokeWidth={2} />
          </button>
        </div>
        <p className="text-sm text-gray-600 mb-4">
          Choose up to {MAX_PINS} fields to show at the top of <strong>More Info</strong> while editing. Order matches
          left to right (then wraps). Same fields stay in the sections below.
        </p>

        {orderedKeys.length > 0 && (
          <ul className="space-y-1.5 mb-4">
            {orderedKeys.map((key, i) => (
              <li
                key={key}
                className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50/80 px-2 py-1.5 text-sm"
              >
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

        {availableToAdd.length > 0 && orderedKeys.length < MAX_PINS && (
          <div className="mb-4">
            <label className="block text-xs font-medium text-gray-500 mb-1">Add field</label>
            <select
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value=""
              onChange={(e) => {
                const v = e.target.value;
                if (v) addKey(v);
                e.target.value = "";
              }}
            >
              <option value="">Choose a field…</option>
              {availableToAdd.map((k) => (
                <option key={k} value={k}>
                  {CARD_DETAIL_PIN_LABELS[k] || k}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-gray-100">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={() => onSave(orderedKeys)}
            disabled={isSaving}
          >
            {isSaving ? "Saving…" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
