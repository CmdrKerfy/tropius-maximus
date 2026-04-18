/** Shared styles for AppShellHeader and legacy in-page nav pills (Explore). */

export function shellPrimaryNavLinkClass({ isActive }) {
  return `px-3 py-1.5 rounded text-sm font-medium transition-colors ${
    isActive
      ? "bg-white text-tm-canopy shadow-sm"
      : "bg-tm-leaf/85 text-white hover:bg-tm-leaf focus-visible:ring-2 focus-visible:ring-tm-mist/50"
  }`;
}

/** Dropdown trigger: matches primary pill; routeActive keeps highlight when menu closed. */
export function shellDropdownTriggerClass(routeActive) {
  return `inline-flex items-center gap-0.5 rounded px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-tm-mist/50 border-0 cursor-pointer ${
    routeActive
      ? "bg-white text-tm-canopy shadow-sm"
      : "bg-tm-leaf/85 text-white hover:bg-tm-leaf data-[state=open]:bg-white data-[state=open]:text-tm-canopy"
  }`;
}

export function shellDropdownNavLinkClass({ isActive }) {
  return `flex w-full cursor-default select-none items-center rounded-md px-2.5 py-2 text-sm outline-none focus:bg-gray-100 data-[highlighted]:bg-gray-100 ${
    isActive ? "bg-gray-100 font-medium text-tm-canopy" : "text-gray-700"
  }`;
}
