import { NavLink } from "react-router-dom";
import { AppLogo } from "@/components/brand/app-logo";
import { type UserRole } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/store/ui-store";
import {
  NAV_ITEMS,
  groupNavItems,
  navItemLabel,
  visibleNavItems,
  type AppNavItem,
} from "@/components/layout/nav-config";
import { UserMenu } from "@/components/layout/user-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAuth } from "@/hooks/use-auth";
import { useHasApprovedMagistrateCourt } from "@/hooks/use-magistrate-court-requests";
import { ROUTES } from "@/routes/paths";

const MobileNavLink = ({
  item,
  onNavigate,
}: {
  item: AppNavItem;
  onNavigate: () => void;
}) => {
  const Icon = item.icon;
  const label = navItemLabel(item);

  return (
    <NavLink
      to={item.href}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          "flex min-h-11 items-center gap-3 rounded-sm px-3 py-2 text-sm font-medium transition-colors",
          isActive
            ? "bg-white/10 text-white"
            : "text-white/75 hover:bg-white/5 hover:text-white",
        )
      }
      end={item.href === ROUTES.dashboard}
    >
      <Icon className="h-4 w-4 shrink-0 text-white/55" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </NavLink>
  );
};

export function MobileNav() {
  const mobileNavOpen = useUiStore((state) => state.mobileNavOpen);
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen);
  const { profile } = useAuth();
  const { data: hasApprovedMagistrateCourt } = useHasApprovedMagistrateCourt();
  const isPendingMagistrate = profile?.role === "magistrate" && hasApprovedMagistrateCourt === false;
  const handleNavigate = () => setMobileNavOpen(false);
  const { ungrouped, groups } = groupNavItems(
    visibleNavItems(NAV_ITEMS, profile?.role as UserRole | undefined, isPendingMagistrate),
  );

  return (
    <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
      <SheetContent
        side="left"
        className="flex w-[min(20rem,88vw)] flex-col border-white/10 bg-[#141414] p-0 pt-[env(safe-area-inset-top,0px)] text-white"
      >
        <SheetHeader className="px-4 pb-3 pt-4 text-left">
          <SheetTitle className="text-left font-normal">
            <AppLogo size="sm" />
          </SheetTitle>
          <SheetDescription className="sr-only">
            Browse court work, research, and your saved material.
          </SheetDescription>
        </SheetHeader>

        <nav
          className="flex-1 space-y-5 overflow-y-auto overscroll-contain px-2 pb-4"
          aria-label="Main"
        >
          {ungrouped.length > 0 && (
            <div className="space-y-0.5">
              {ungrouped.map((item) => (
                <MobileNavLink
                  key={item.href}
                  item={item}
                  onNavigate={handleNavigate}
                />
              ))}
            </div>
          )}

          {groups.map((section) => (
            <section
              key={section.id}
              aria-labelledby={`mobile-nav-${section.id}`}
              className="space-y-1"
            >
              <h2
                id={`mobile-nav-${section.id}`}
                className="px-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40"
              >
                {section.label}
              </h2>
              <div className="space-y-0.5">
                {section.items.map((item) => (
                  <MobileNavLink
                    key={item.href}
                    item={item}
                    onNavigate={handleNavigate}
                  />
                ))}
              </div>
            </section>
          ))}
        </nav>

        <div className="border-t border-white/10 p-3">
          <UserMenu />
        </div>
      </SheetContent>
    </Sheet>
  );
}
