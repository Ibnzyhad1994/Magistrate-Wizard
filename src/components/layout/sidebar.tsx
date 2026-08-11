import { NavLink } from "react-router-dom";
import { ChevronLeft, Scale } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/store/ui-store";
import { NAV_ITEMS } from "@/components/layout/nav-config";
import { UserMenu } from "@/components/layout/user-menu";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";

/**
 * Persistent desktop sidebar. Collapses to an icon rail (state persisted
 * via `useUiStore`); see `mobile-nav.tsx` for the small-viewport
 * equivalent rendered inside a `Sheet`.
 */
export function Sidebar() {
  const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const { profile } = useAuth();

  return (
    <aside
      className={cn(
        "hidden h-dvh flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 lg:flex",
        sidebarCollapsed ? "w-16" : "w-64",
      )}
    >
      <div className="flex h-14 items-center gap-2 px-4">
        <Scale className="h-5 w-5 shrink-0" aria-hidden="true" />
        {!sidebarCollapsed && (
          <span className="truncate text-sm font-semibold tracking-tight">
            BenchBook
          </span>
        )}
      </div>

      <Separator className="bg-sidebar-border" />

      <nav className="flex-1 space-y-1 overflow-y-auto p-2">
        {NAV_ITEMS.filter(
          (item) => !item.roles || (profile && item.roles.includes(profile.role)),
        ).map((item) => {
          const Icon = item.icon;
          const link = (
            <NavLink
              key={item.href}
              to={item.href}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80",
                  sidebarCollapsed && "justify-center px-0",
                )
              }
              end
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
            </NavLink>
          );

          if (!sidebarCollapsed) return link;

          return (
            <Tooltip key={item.href}>
              <TooltipTrigger asChild>{link}</TooltipTrigger>
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </nav>

      <Separator className="bg-sidebar-border" />

      <div className="p-2">
        {!sidebarCollapsed ? (
          <UserMenu />
        ) : (
          <div className="flex justify-center py-1">
            <UserMenu />
          </div>
        )}
      </div>

      <div className="flex justify-end p-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          onClick={toggleSidebar}
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <ChevronLeft
            className={cn(
              "h-4 w-4 transition-transform",
              sidebarCollapsed && "rotate-180",
            )}
          />
        </Button>
      </div>
    </aside>
  );
}
