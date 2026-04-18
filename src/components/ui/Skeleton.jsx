/**
 * Phase 1 loading primitive.
 */
export default function Skeleton({ className = "" }) {
  return <div className={`animate-pulse rounded-md bg-gray-200/80 ${className}`.trim()} aria-hidden="true" />;
}
