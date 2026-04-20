import { BATCH_EDIT_MAX_CARDS } from "./batchLimits.js";

export const BATCH_SELECTION_STORAGE_VERSION = 1;

export function batchSelectionStorageKey(userId) {
  const seg = userId && typeof userId === "string" ? userId : "anon";
  return `tm_batch_selection_v${BATCH_SELECTION_STORAGE_VERSION}:${seg}`;
}

/**
 * @param {string | null | undefined} userId
 * @returns {{ ids: string[], updatedAtMs: number }}
 */
export function readBatchSelectionState(userId) {
  if (typeof window === "undefined") return { ids: [], updatedAtMs: 0 };
  try {
    const raw = localStorage.getItem(batchSelectionStorageKey(userId));
    if (!raw) return { ids: [], updatedAtMs: 0 };
    const data = JSON.parse(raw);
    if (!data || data.version !== BATCH_SELECTION_STORAGE_VERSION || !Array.isArray(data.ids)) {
      return { ids: [], updatedAtMs: 0 };
    }
    const ids = data.ids.filter((x) => typeof x === "string" && x.length > 0);
    const t = data.updatedAt ? Date.parse(String(data.updatedAt)) : NaN;
    return { ids, updatedAtMs: Number.isFinite(t) ? t : 0 };
  } catch {
    return { ids: [], updatedAtMs: 0 };
  }
}

/**
 * @param {string | null | undefined} userId
 * @returns {string[]}
 */
export function readBatchSelectionIds(userId) {
  return readBatchSelectionState(userId).ids;
}

/**
 * @param {string | null | undefined} userId
 * @param {string[]} ids
 */
export function writeBatchSelectionIds(userId, ids) {
  if (typeof window === "undefined") return;
  const unique = [...new Set(ids.filter((x) => typeof x === "string" && x.length > 0))];
  const capped = unique.slice(0, BATCH_EDIT_MAX_CARDS);
  localStorage.setItem(
    batchSelectionStorageKey(userId),
    JSON.stringify({
      version: BATCH_SELECTION_STORAGE_VERSION,
      ids: capped,
      updatedAt: new Date().toISOString(),
    })
  );
}

export function clearBatchSelectionStorage(userId) {
  if (typeof window === "undefined") return;
  localStorage.removeItem(batchSelectionStorageKey(userId));
}
