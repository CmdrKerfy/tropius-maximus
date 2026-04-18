/**
 * Unified app shell (canopy header + `AppLayout` / `AppShellHeader`).
 *
 * **Default: on** for all environments unless explicitly disabled.
 * Set `VITE_EXPERIMENTAL_NAV=false` in `.env.local` or Vercel to restore **legacy**
 * per-page green headers and no global shell (debug / comparison only).
 */
export function isExperimentalAppNav() {
  return import.meta.env.VITE_EXPERIMENTAL_NAV !== "false";
}

export function useExperimentalAppNav() {
  return isExperimentalAppNav();
}
