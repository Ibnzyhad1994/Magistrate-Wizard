import { useEffect, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { ROUTES } from "@/routes/paths";
import { NAV_ITEMS, groupNavItems, navItemLabel, navTourIdForHref, visibleNavItems } from "@/components/layout/nav-config";
import { AppLogo } from "@/components/brand/app-logo";
import { UserMenu } from "@/components/layout/user-menu";
import { ReportIssueButton } from "@/components/feedback/report-issue-button";
import { NotificationBell } from "@/components/layout/notification-bell";
import { NavSearch } from "@/components/layout/nav-search";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useUiStore } from "@/store/ui-store";
import { useAuth } from "@/hooks/use-auth";
import { useCinematicNav } from "@/components/layout/cinematic-nav";
import { useTheme } from "@/providers/use-theme";
import { isDarkPalette } from "@/lib/theme";
import { useHasApprovedMagistrateCourt } from "@/hooks/use-magistrate-court-requests";
import { useIsDesktop, useMediaQuery } from "@/hooks/use-media-query";

const PRIMARY_HREFS = new Set<string>([
  ROUTES.dashboard,
  ROUTES.docket,
  ROUTES.judgments,
  ROUTES.caseLaw,
  ROUTES.legislation,
]);

/**
 * Netflix-style fixed top bar: dark fade + light ink over a Billboard,
 * solid canvas after 50px of scroll (and on paper pages with no hero).
 */
export function TopNav() {
  const [scrolled, setScrolled] = useState(false);
  const cinematic = useCinematicNav();
  const { resolvedTheme } = useTheme();
  const overlay = cinematic && !scrolled && isDarkPalette(resolvedTheme);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const mobileNavOpen = useUiStore((state) => state.mobileNavOpen);
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen);
  const isDesktop = useIsDesktop();
  const showWordmark = useMediaQuery("(min-width: 400px)");
  const { profile } = useAuth();
  const { data: hasApprovedMagistrateCourt } = useHasApprovedMagistrateCourt();
  // Locked-down state: a magistrate with zero currently-active
  // magistrate_courts assignments. Mirrors requireApprovedMagistrateCourt
  // (router.tsx) -- the nav must never dangle a link to a page the route
  // gate will just bounce them right back out of.
  const isPendingMagistrate = profile?.role === "magistrate" && hasApprovedMagistrateCourt === false;

  useEffect(() => {
    function onScroll() {
      const top =
        window.scrollY ||
        document.querySelector("main")?.scrollTop ||
        0;
      setScrolled(top > 50);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    const main = document.querySelector("main");
    main?.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      main?.removeEventListener("scroll", onScroll);
    };
  }, []);

  const visibleItems = visibleNavItems(NAV_ITEMS, profile?.role, isPendingMagistrate);
  const primary = visibleItems.filter((item) => PRIMARY_HREFS.has(item.href));
  const more = visibleItems.filter((item) => !PRIMARY_HREFS.has(item.href));
  const moreGroups = groupNavItems(more).groups;

  const handleSearchSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = query.trim();
    navigate(trimmed ? `${ROUTES.search}?q=${encodeURIComponent(trimmed)}` : ROUTES.search);
    setSearchOpen(false);
  };

  const handleOpenSearch = () => setSearchOpen(true);
  const handleCloseSearch = () => setSearchOpen(false);

  const handleOpenMobileNav = () => setMobileNavOpen(true);
  const hideActionCluster = searchOpen && !isDesktop;

  const chromeBtn = overlay
    ? "text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
    : "text-foreground hover:bg-foreground/10";

  return (
    <header
      data-nav-overlay={overlay ? "true" : undefined}
      className={cn(
        "fixed inset-x-0 top-0 z-50 flex h-[calc(68px+env(safe-area-inset-top,0px))] items-center gap-2 overflow-hidden pt-[env(safe-area-inset-top,0px)] transition-colors duration-300 sm:gap-3 lg:gap-6",
        "browse-gutter",
        overlay
          ? "bg-transparent bg-gradient-to-b from-black/80 to-transparent text-primary-foreground"
          : "bg-background text-foreground",
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        className={cn("min-h-11 min-w-11 shrink-0 touch-manipulation lg:hidden", chromeBtn)}
        onClick={handleOpenMobileNav}
        aria-label="Open navigation"
        aria-expanded={mobileNavOpen}
        aria-haspopup="dialog"
        data-tour="nav-more"
      >
        <Menu className="h-6 w-6" />
      </Button>

      <Link
        to={isPendingMagistrate ? ROUTES.courtAssignments : ROUTES.dashboard}
        className={cn(
          "rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          hideActionCluster ? "shrink-0" : "min-w-0 shrink",
        )}
      >
        <AppLogo size="md" markOnly={!showWordmark || hideActionCluster} />
      </Link>

      <nav
        className={cn(
          "hidden items-center gap-5 text-sm font-medium lg:flex",
          overlay ? "text-primary-foreground/80" : "text-foreground/80",
        )}
      >
        {primary.map((item) => (
          <NavLink
            key={item.href}
            to={item.href}
            className={({ isActive }) =>
              cn(
                "transition-colors",
                overlay ? "hover:text-primary-foreground" : "hover:text-foreground",
                isActive && (overlay ? "font-semibold text-primary-foreground" : "font-semibold text-foreground"),
              )
            }
            end={item.href === ROUTES.dashboard}
            data-tour={navTourIdForHref(item.href)}
          >
            {navItemLabel(item)}
          </NavLink>
        ))}
        {more.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "text-sm font-medium outline-none",
                overlay
                  ? "text-primary-foreground/80 hover:text-primary-foreground"
                  : "text-foreground/80 hover:text-foreground",
              )}
              data-tour="nav-more"
            >
              More
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[12rem] border-foreground/10 bg-card">
              {moreGroups.map((section, index) => (
                <DropdownMenuGroup key={section.id}>
                  {index > 0 ? <DropdownMenuSeparator className="bg-foreground/10" /> : null}
                  <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    {section.label}
                  </DropdownMenuLabel>
                  {section.items.map((item) => (
                    <DropdownMenuItem key={item.href} asChild>
                      <Link to={item.href} data-tour={navTourIdForHref(item.href)}>
                        {item.label}
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </nav>

      <div
        className={cn(
          "ml-auto flex items-center gap-1 sm:gap-3",
          hideActionCluster ? "min-w-0 flex-1" : "shrink-0",
        )}
      >
        {isPendingMagistrate ? null : (
          <NavSearch
            open={searchOpen}
            query={query}
            onQueryChange={setQuery}
            onOpen={handleOpenSearch}
            onClose={handleCloseSearch}
            onSubmit={handleSearchSubmit}
            buttonClassName={chromeBtn}
          />
        )}
        {hideActionCluster ? null : (
          <>
            {/* Hidden for a pending magistrate for the same reason search is:
                /notifications sits behind requireApprovedMagistrateCourt, so
                the bell would be a link that only ever bounces them back. */}
            {isPendingMagistrate ? null : <NotificationBell className={chromeBtn} />}
            <ReportIssueButton className={chromeBtn} />
            <UserMenu compact />
          </>
        )}
      </div>
    </header>
  );
}
