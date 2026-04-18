/**
 * Feature flag for the canopy shell + grouped nav (Activity / Manage data).
 * Set `VITE_EXPERIMENTAL_NAV=true` in `.env.local` to test locally.
 */
export function isExperimentalAppNav() {
  return import.meta.env.VITE_EXPERIMENTAL_NAV === "true";
}

export function useExperimentalAppNav() {
  return isExperimentalAppNav();
}
