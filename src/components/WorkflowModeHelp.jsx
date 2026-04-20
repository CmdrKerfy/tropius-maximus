import { ChevronDown } from "lucide-react";

/**
 * Collapsible in-page help for Workbench, Batch, and similar modes.
 * Uses native <details> for accessibility without extra JS.
 */
export default function WorkflowModeHelp({ summary, children }) {
  return (
    <details className="group rounded-xl border border-gray-200 bg-white shadow-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-gray-900 hover:bg-gray-50/80 [&::-webkit-details-marker]:hidden">
        <ChevronDown
          className="h-4 w-4 shrink-0 text-gray-500 transition-transform duration-200 group-open:rotate-180"
          strokeWidth={2}
          aria-hidden
        />
        {summary}
      </summary>
      <div className="border-t border-gray-100 px-4 py-3 text-sm text-gray-700 leading-relaxed space-y-3">
        {children}
      </div>
    </details>
  );
}
