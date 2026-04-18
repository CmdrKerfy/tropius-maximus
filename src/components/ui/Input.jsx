/**
 * Phase 1 primitive text input.
 */
export default function Input({
  className = "",
  type = "text",
  disabled = false,
  ...props
}) {
  const base =
    "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 " +
    "placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-tm-mist/70 focus:border-transparent " +
    "disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed";
  return <input type={type} disabled={disabled} className={`${base} ${className}`.trim()} {...props} />;
}
