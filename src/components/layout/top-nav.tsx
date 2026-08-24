import { useEffect, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { Menu, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { ROUTES } from "@/routes/paths";
import { NAV_ITEMS, groupNavItems, navItemLabel, visibleNavItems } from "@/components/layout/nav-config";
import { AppLogo } from "@/components/brand/app-logo";
import { UserMenu } from "@/components/layout/user-menu";
import { MobileSearchDialog } from "@/components/layout/mobile-search-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { useIsDesktop, useMediaQuery } from "@/hooks/use-media-query";

const PRIMARY_HREFS = new Set<string>([
  ROUTES.dashboard,
  ROUTES.docket,
  ROUTES.judgments,
  ROUTES.caseLaw,
  ROUTES.legislation,
]);

/**
 * Netflix-style fixed top bar: transparent over the billboard, solid
 * #141414 after 50px of scroll. Logo + text links left, search +
 * profile right.
 */
export function TopNav() {
  const [scrolled, setScrolled] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const mobileNavOpen = useUiStore((state) => state.mobileNavOpen);
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen);
  const isDesktop = useIsDesktop();
  const showWordmark = useMediaQuery("(min-width: 400px)");
  const { profile } = useAuth();

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

  const visibleItems = visibleNavItems(NAV_ITEMS, profile?.role);
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

  const handleSearchOpenChange = (open: boolean) => setSearchOpen(open);

  const handleOpenMobileNav = () => setMobileNavOpen(true);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 flex h-[calc(68px+env(safe-area-inset-top,0px))] items-center gap-2 overflow-hidden pt-[env(safe-area-inset-top,0px)] transition-colors duration-300 sm:gap-3 lg:gap-6",
        "browse-gutter",
        scrolled
          ? "bg-[#141414]"
          : "bg-gradient-to-b from-black/80 to-transparent",
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        className="min-h-11 min-w-11 shrink-0 touch-manipulation text-white hover:bg-white/10 lg:hidden"
        onClick={handleOpenMobileNav}
        aria-label="Open navigation"
        aria-expanded={mobileNavOpen}
        aria-haspopup="dialog"
      >
        <Menu className="h-6 w-6" />
      </Button>

      <Link
        to={ROUTES.dashboard}
        className="min-w-0 shrink rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <AppLogo size="md" markOnly={!showWordmark} />
      </Link>

      <nav className="hidden items-center gap-5 text-sm font-medium text-white/80 lg:flex">
        {primary.map((item) => (
          <NavLink
            key={item.href}
            to={item.href}
            className={({ isActive }) =>
              cn(
                "transition-colors hover:text-white",
                isActive && "font-semibold text-white",
              )
            }
            end={item.href === ROUTES.dashboard}
          >
            {navItemLabel(item)}
          </NavLink>
        ))}
        {more.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger className="text-sm font-medium text-white/80 outline-none hover:text-white">
              More
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[12rem] border-white/10 bg-[#181818]">
              {moreGroups.map((section, index) => (
                <DropdownMenuGroup key={section.id}>
                  {index > 0 ? <DropdownMenuSeparator className="bg-white/10" /> : null}
                  <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/40">
                    {section.label}
                  </DropdownMenuLabel>
                  {section.items.map((item) => (
                    <DropdownMenuItem key={item.href} asChild>
                      <Link to={item.href}>{item.label}</Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </nav>

      <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-3">
        {isDesktop && searchOpen ? (
          <form onSubmit={handleSearchSubmit} className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/60" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onBlur={() => {
                if (!query) setSearchOpen(false);
              }}
              placeholder="Titles, notes, legislation…"
              className="h-9 w-48 border-white/40 bg-black/70 pl-8 text-sm text-white placeholder:text-white/50 sm:w-64"
              aria-label="Search"
            />
          </form>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="min-h-11 min-w-11 shrink-0 touch-manipulation text-white hover:bg-white/10"
            onClick={handleOpenSearch}
            aria-label="Search"
            aria-haspopup={isDesktop ? undefined : "dialog"}
            aria-expanded={isDesktop ? undefined : searchOpen}
          >
            <Search className="h-5 w-5" />
          </Button>
        )}
        <UserMenu compact />
      </div>
      {!isDesktop ? (
        <MobileSearchDialog
          open={searchOpen}
          query={query}
          onQueryChange={setQuery}
          onOpenChange={handleSearchOpenChange}
          onSubmit={handleSearchSubmit}
        />
      ) : null}
    </header>
  );
}
