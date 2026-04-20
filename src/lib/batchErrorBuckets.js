/**
 * Group batch per-card errors for clearer UI (Batch wizard, etc.).
 */

export const BATCH_ERROR_BUCKET_ORDER = ["conflict", "permission", "network", "other"];

export const BATCH_ERROR_BUCKET_LABELS = {
  conflict: "Version / conflict",
  permission: "Sign-in / permissions",
  network: "Network",
  other: "Other",
};

/**
 * @param {string | undefined} message
 * @returns {"conflict" | "permission" | "network" | "other"}
 */
export function bucketBatchErrorMessage(message) {
  const m = String(message ?? "").toLowerCase();
  if (/p0001|version conflict|optimistic|concurrent|another edit|conflict/i.test(m)) return "conflict";
  if (/rls|row level|policy|permission|jwt|auth|sign in|401|403|forbidden|unauthorized/i.test(m))
    return "permission";
  if (/network|fetch|failed to fetch|timeout|load failed|aborted/i.test(m)) return "network";
  return "other";
}

/**
 * @param {{ cardId: string, message: string }[]} errors
 * @returns {Record<string, { cardId: string, message: string }[]>}
 */
export function groupBatchErrorsByBucket(errors) {
  const buckets = { conflict: [], permission: [], network: [], other: [] };
  for (const e of errors || []) {
    buckets[bucketBatchErrorMessage(e.message)].push(e);
  }
  return buckets;
}
