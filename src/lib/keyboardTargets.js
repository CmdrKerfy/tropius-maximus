/**
 * True when a key event's target consumes arrow keys itself: text fields,
 * selects, content-editable regions, and ARIA widgets with their own arrow
 * navigation. Global shortcuts (e.g. Card Detail prev/next) should ignore
 * arrows from these so typing does not jump to another card.
 */
const TEXT_INPUT_TYPES = new Set([
  "", "text", "search", "email", "url", "tel", "password", "number",
  "date", "datetime-local", "month", "time", "week", "range",
]);

const ARROW_KEY_WIDGET_SELECTOR = [
  "combobox", "listbox", "option", "slider", "spinbutton", "radiogroup",
  "radio", "tablist", "tab", "menu", "menubar", "menuitem",
  "menuitemcheckbox", "menuitemradio", "textbox", "grid", "tree",
].map((role) => `[role="${role}"]`).join(",");

export function isArrowKeyConsumer(target) {
  if (!target || typeof target !== "object") return false;
  const tag = String(target.tagName || "").toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    return TEXT_INPUT_TYPES.has(String(target.type || "").toLowerCase());
  }
  if (target.isContentEditable) return true;
  return typeof target.closest === "function" && target.closest(ARROW_KEY_WIDGET_SELECTOR) != null;
}
