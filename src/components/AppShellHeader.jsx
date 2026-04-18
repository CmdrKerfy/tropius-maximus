import { NavLink, useLocation } from "react-router-dom";
import AuthUserMenu from "./AuthUserMenu.jsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/DropdownMenu.jsx";
import {
  shellPrimaryNavLinkClass,
  shellDropdownTriggerClass,
  shellDropdownNavLinkClass,
} from "../lib/appShellNavStyles.js";

function MobileNavMenu() {
  const { pathname, search } = useLocation();
  const activityRoute = pathname === "/dashboard" || pathname === "/history";
  const manageRoute =
    pathname === "/fields" || pathname === "/batch" || pathname === "/health";
  const anySecondary = activityRoute || manageRoute;

  return (
    <div className="flex lg:hidden flex-1 justify-center min-w-0 px-1">
      <DropdownMenu>
        <DropdownMenuTrigger
          type="button"
          className={`${shellDropdownTriggerClass(anySecondary)} max-w-full gap-1.5`}
          aria-label="Open navigation menu"
        >
          <span className="text-base leading-none" aria-hidden>
            ☰
          </span>
          <span className="text-sm font-medium">Menu</span>
          <span className="text-[0.65rem] opacity-90" aria-hidden>
            ▾
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="min-w-[14rem] max-h-[min(24rem,70vh)] overflow-y-auto">
          <DropdownMenuItem asChild>
            <NavLink to="/" end className={shellDropdownNavLinkClass}>
              Explore
            </NavLink>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <NavLink to="/workbench" className={shellDropdownNavLinkClass}>
              Workbench
            </NavLink>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
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
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <NavLink to="/fields" className={shellDropdownNavLinkClass}>
              Fields
            </NavLink>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <NavLink to={{ pathname: "/batch", search: search || "" }} className={shellDropdownNavLinkClass}>
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
    </div>
  );
}

export default function AppShellHeader() {
  const { pathname, search } = useLocation();
  const activityRoute = pathname === "/dashboard" || pathname === "/history";
  const manageRoute =
    pathname === "/fields" || pathname === "/batch" || pathname === "/health";

  return (
    <header className="bg-tm-canopy text-white shadow-lg z-20 relative">
      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-3 sm:py-4 flex flex-wrap items-center justify-between gap-2 sm:gap-3">
        <NavLink
          to="/"
          className="flex items-center gap-2 min-w-0 shrink-0 rounded-full focus-visible:ring-2 focus-visible:ring-tm-mist/50"
        >
          <img
            src={`${import.meta.env.BASE_URL}favicon.png`}
            alt=""
            className="h-10 w-10 sm:h-12 sm:w-12 shrink-0 rounded-full object-cover"
          />
          <span className="text-xs sm:text-sm md:text-lg font-bold tracking-tight text-white truncate max-w-[9rem] sm:max-w-[11rem] md:max-w-[16rem]">
            Tropius Maximus
          </span>
        </NavLink>

        <MobileNavMenu />

        <nav className="hidden lg:flex flex-wrap items-center gap-2 flex-1 justify-center min-w-0">
          <NavLink to="/" end className={shellPrimaryNavLinkClass}>
            Explore
          </NavLink>
          <NavLink to="/workbench" className={shellPrimaryNavLinkClass}>
            Workbench
          </NavLink>

          <DropdownMenu>
            <DropdownMenuTrigger type="button" className={shellDropdownTriggerClass(activityRoute)}>
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
            <DropdownMenuTrigger type="button" className={shellDropdownTriggerClass(manageRoute)}>
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
