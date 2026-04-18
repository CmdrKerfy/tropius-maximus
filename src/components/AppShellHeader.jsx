import { NavLink, useLocation } from "react-router-dom";
import AuthUserMenu from "./AuthUserMenu.jsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/DropdownMenu.jsx";
import {
  shellPrimaryNavLinkClass,
  shellDropdownTriggerClass,
  shellDropdownNavLinkClass,
} from "../lib/appShellNavStyles.js";

export default function AppShellHeader() {
  const { pathname, search } = useLocation();
  const activityRoute = pathname === "/dashboard" || pathname === "/history";
  const manageRoute =
    pathname === "/fields" || pathname === "/batch" || pathname === "/health";

  return (
    <header className="bg-tm-canopy text-white shadow-lg z-20 relative">
      <div className="max-w-7xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-3">
        <NavLink
          to="/"
          className="flex items-center gap-2 min-w-0 shrink-0 rounded-full focus-visible:ring-2 focus-visible:ring-tm-mist/50"
        >
          <img
            src={`${import.meta.env.BASE_URL}favicon.png`}
            alt=""
            className="h-12 w-12 sm:h-14 sm:w-14 shrink-0 rounded-full object-cover"
          />
          <span className="text-sm sm:text-lg font-bold tracking-tight text-white truncate max-w-[11rem] sm:max-w-[16rem]">
            Tropius Maximus
          </span>
        </NavLink>

        <nav className="flex flex-wrap items-center gap-2 order-3 sm:order-none w-full sm:w-auto sm:flex-1 sm:justify-center">
          <NavLink to="/" end className={shellPrimaryNavLinkClass}>
            Explore
          </NavLink>
          <NavLink to="/workbench" className={shellPrimaryNavLinkClass}>
            Workbench
          </NavLink>

          <DropdownMenu>
            <DropdownMenuTrigger className={shellDropdownTriggerClass(activityRoute)}>
              Activity
              <span className="text-[0.65rem] opacity-90" aria-hidden>
                ▾
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[11rem]">
              <DropdownMenuItem asChild>
                <NavLink to="/dashboard" className={shellDropdownNavLinkClass}>
                  Dashboard
                </NavLink>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <NavLink to="/history" className={shellDropdownNavLinkClass}>
                  Edit history
                </NavLink>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger className={shellDropdownTriggerClass(manageRoute)}>
              Manage data
              <span className="text-[0.65rem] opacity-90" aria-hidden>
                ▾
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[11rem]">
              <DropdownMenuItem asChild>
                <NavLink to="/fields" className={shellDropdownNavLinkClass}>
                  Fields
                </NavLink>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <NavLink to={{ pathname: "/batch", search }} className={shellDropdownNavLinkClass}>
                  Batch
                </NavLink>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <NavLink to="/health" className={shellDropdownNavLinkClass}>
                  Data Health
                </NavLink>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          <AuthUserMenu />
        </div>
      </div>
    </header>
  );
}
