/**
 * Phase 1 primitive badge with token-friendly variants.
 */
const variants = {
  neutral: "bg-gray-100 text-gray-700 border border-gray-200",
  success: "bg-tm-success-soft text-tm-success border border-tm-success/20",
  warning: "bg-tm-warning-soft text-tm-warning border border-tm-warning/25",
  danger: "bg-tm-danger-soft text-tm-danger border border-tm-danger/20",
  info: "bg-tm-info-soft text-tm-info border border-tm-info/20",
  fruit: "bg-tm-fruit-soft text-tm-fruit border border-tm-fruit/25",
};

export default function Badge({ children, className = "", variant = "neutral" }) {
  const cls = variants[variant] || variants.neutral;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls} ${className}`.trim()}
    >
      {children}
    </span>
  );
}
