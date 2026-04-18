/**
 * Phase 1 UI primitive — Tropius token variants. Extend as pages migrate off ad-hoc classes.
 */
import { forwardRef } from "react";

const variants = {
  primary:
    "bg-tm-leaf text-white hover:bg-tm-leaf-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tm-mist disabled:opacity-50 disabled:pointer-events-none",
  secondary:
    "bg-white text-tm-canopy border border-tm-leaf/30 hover:bg-tm-cream focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tm-mist disabled:opacity-50",
  ghost: "bg-transparent text-tm-canopy hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-tm-mist/80 disabled:opacity-40",
  danger:
    "bg-tm-danger text-white hover:bg-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tm-danger disabled:opacity-50",
};

const sizes = {
  sm: "px-2.5 py-1 text-xs font-medium rounded-md",
  md: "px-3 py-1.5 text-sm font-medium rounded-lg",
  lg: "px-4 py-2.5 text-sm font-semibold rounded-lg",
};

const Button = forwardRef(function Button(
  { className = "", variant = "primary", size = "md", type = "button", ...props },
  ref
) {
  const base =
    "inline-flex items-center justify-center gap-2 transition-colors select-none " +
    (variants[variant] || variants.primary) +
    " " +
    (sizes[size] || sizes.md);
  return <button ref={ref} type={type} className={`${base} ${className}`.trim()} {...props} />;
});

export default Button;
