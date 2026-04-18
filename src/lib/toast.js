import { toast as sonnerToast } from "sonner";
import { humanizeError } from "./humanizeError.js";

/** Thin wrappers so call sites do not import `sonner` directly (Phase 2). */

export function toastSuccess(message, options) {
  return sonnerToast.success(message, options);
}

/** Pass a string or any thrown value; message is passed through {@link humanizeError}. */
export function toastError(errOrMessage, options) {
  return sonnerToast.error(humanizeError(errOrMessage), { duration: 6500, ...options });
}

export function toastWarning(message, options) {
  return sonnerToast.warning(message, { duration: 6000, ...options });
}

/**
 * @param {Promise<T>} promise
 * @param {{ loading: string; success: string | ((data: T) => string); error?: string | ((err: unknown) => string) }} messages
 */
export function toastPromise(promise, messages) {
  return sonnerToast.promise(promise, messages);
}
