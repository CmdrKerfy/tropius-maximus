/**
 * Phase 1 — simple elevated surface. Use `padding={false}` for full-bleed children.
 */
export default function Card({ children, className = "", padding = true }) {
  const pad = padding ? "p-4" : "";
  return (
    <div
      className={`rounded-xl border border-gray-200/80 bg-white shadow-sm ${pad} ${className}`.trim()}
    >
      {children}
    </div>
  );
}
