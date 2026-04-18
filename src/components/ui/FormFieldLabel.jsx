import { splitUiLabel } from "../../lib/splitUiLabel.js";

/** Two-line field label: primary + optional parenthetical / secondary line. */
export default function FormFieldLabel({ children, htmlFor, className = "" }) {
  const text = children == null ? "" : String(children);
  const { primary, secondary } = splitUiLabel(text);
  return (
    <label
      htmlFor={htmlFor}
      className={`block text-sm font-semibold text-gray-800 mb-1 leading-snug ${className}`.trim()}
    >
      <span className="break-words">{primary}</span>
      {secondary ? (
        <span className="mt-0.5 block text-xs font-normal text-gray-500 break-words">{secondary}</span>
      ) : null}
    </label>
  );
}
