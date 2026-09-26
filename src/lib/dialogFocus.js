/**
 * Focus handling for hand-built modals (CardDetail is not a Radix Dialog):
 * move focus into the dialog on open, keep Tab inside it, and return focus
 * to whatever opened it on close.
 */
import { useEffect } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]", "area[href]", "button:not([disabled])", "input:not([disabled]):not([type=\"hidden\"])",
  "select:not([disabled])", "textarea:not([disabled])", "iframe", "[contenteditable=\"true\"]",
  "[tabindex]:not([tabindex=\"-1\"])",
].join(",");

/** Focus `containerRef` on mount (unless focus is already inside); restore the previous focus on unmount. */
export function useDialogFocus(containerRef) {
  useEffect(() => {
    const previous = document.activeElement;
    const container = containerRef.current;
    if (container && !container.contains(document.activeElement)) {
      container.focus({ preventScroll: true });
    }
    return () => {
      if (previous && previous !== document.body && previous.isConnected && typeof previous.focus === "function") {
        previous.focus({ preventScroll: true });
      }
    };
  }, [containerRef]);
}

/**
 * onKeyDown handler for the dialog root: wraps Tab / Shift+Tab at the ends.
 * Ignores events whose DOM target is outside the root (React bubbles events
 * from portaled children such as dropdown menus; those manage their own focus).
 */
export function trapTabKey(e) {
  if (e.key !== "Tab" || e.defaultPrevented) return;
  const root = e.currentTarget;
  if (!(e.target instanceof Node) || !root.contains(e.target)) return;
  const focusables = Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
    (el) => el.getClientRects().length > 0
  );
  if (focusables.length === 0) {
    e.preventDefault();
    root.focus({ preventScroll: true });
    return;
  }
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && (active === first || active === root)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}
