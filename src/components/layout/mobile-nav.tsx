import { NavLink } from "react-router-dom";
import { Scale } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/store/ui-store";
import { NAV_ITEMS } from "@/components/layout/nav-config";
import { UserMenu } from "@/components/layout/user-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/hooks/use-auth";

/**
 * Sheet-based navigation for viewports below `lg`. Shares `NAV_ITEMS`
 * with the desktop sidebar so nav structure only needs to be defined
 * once.
 */
export function MobileNav() {
  const mobileNavOpen = useUiStore((state) => state.mobileNavOpen);
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen);
  const { profile } = useAuth();

  return (
    <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
      <SheetContent side="left" className="flex w-72 flex-col p-0">
        <SheetHeader className="px-4 pt-4 text-left">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Scale className="h-5 w-5" aria-hidden="true" />
            BenchBook
          </SheetTitle>
        </SheetHeader>

        <Separator className="mt-4" />

        <nav className="flex-1 space-y-1 overflow-y-auto p-2">
          {NAV_ITEMS.filter(
            (item) =>
              !item.roles || (profile && item.roles.includes(profile.role)),
          ).map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.href}
                to={item.href}
                onClick={() => setMobileNavOpen(false)}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    "hover:bg-accent hover:text-accent-foreground",
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "text-foreground/80",
                  )
                }
                end
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <Separator />

        <div className="p-2">
          <UserMenu />
        </div>
      </SheetContent>
    </Sheet>
  );
}
