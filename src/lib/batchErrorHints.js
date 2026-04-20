import { bucketBatchErrorMessage } from "./batchErrorBuckets.js";

/**
 * Short actionable line under a per-card batch error (beyond bucket headers).
 * @param {string | undefined} message
 */
export function batchErrorHint(message) {
  const b = bucketBatchErrorMessage(message);
  if (b === "conflict") {
    return "Open the card, refresh to load the latest version, then use “Retry failed only”.";
  }
  if (b === "permission") {
    return "Try signing out and back in. If it persists, check that your account still has access.";
  }
  if (b === "network") {
    return "Check your connection, wait a moment, then use “Retry failed only”.";
  }
  return "";
}
