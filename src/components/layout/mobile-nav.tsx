import { NavLink } from "react-router-dom";
import { APP_NAME } from "@/lib/constants";
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
import { ROUTES } from "@/routes/paths";

export function MobileNav() {
  const mobileNavOpen = useUiStore((state) => state.mobileNavOpen);
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen);
  const { profile } = useAuth();

  return (
    <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
      <SheetContent
        side="left"
        className="flex w-72 flex-col border-white/10 bg-[#141414] p-0 text-white"
      >
        <SheetHeader className="px-4 pt-4 text-left">
          <SheetTitle className="text-lg font-extrabold tracking-tight text-primary">
            {APP_NAME}
          </SheetTitle>
        </SheetHeader>

        <Separator className="mt-4 bg-white/10" />

        <nav className="flex-1 space-y-1 overflow-y-auto p-2">
          {NAV_ITEMS.filter(
            (item) =>
              !item.roles || (profile && item.roles.includes(profile.role)),
          ).map((item) => (
            <NavLink
              key={item.href}
              to={item.href}
              onClick={() => setMobileNavOpen(false)}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-sm px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-white/10 text-white"
                    : "text-white/70 hover:bg-white/5 hover:text-white",
                )
              }
              end={item.href === ROUTES.dashboard}
            >
              {item.label === "Dashboard" ? "Home" : item.label}
            </NavLink>
          ))}
        </nav>

        <Separator className="bg-white/10" />
        <div className="p-3">
          <UserMenu />
        </div>
      </SheetContent>
    </Sheet>
  );
}
