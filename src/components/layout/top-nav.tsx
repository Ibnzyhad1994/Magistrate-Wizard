import { useEffect, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { Menu, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/constants";
import { ROUTES } from "@/routes/paths";
import { NAV_ITEMS } from "@/components/layout/nav-config";
import { UserMenu } from "@/components/layout/user-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useUiStore } from "@/store/ui-store";
import { useAuth } from "@/hooks/use-auth";

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
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen);
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

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.roles || (profile && item.roles.includes(profile.role)),
  );
  const primary = visibleItems.filter((item) => PRIMARY_HREFS.has(item.href as string));
  const more = visibleItems.filter((item) => !PRIMARY_HREFS.has(item.href as string));

  function submitSearch(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = query.trim();
    navigate(trimmed ? `${ROUTES.search}?q=${encodeURIComponent(trimmed)}` : ROUTES.search);
    setSearchOpen(false);
  }

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 flex h-[68px] items-center gap-6 transition-colors duration-300",
        "browse-gutter",
        scrolled
          ? "bg-[#141414]"
          : "bg-gradient-to-b from-black/80 to-transparent",
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden text-white hover:bg-white/10"
        onClick={() => setMobileNavOpen(true)}
        aria-label="Open navigation"
      >
        <Menu className="h-6 w-6" />
      </Button>

      <Link
        to={ROUTES.dashboard}
        className="shrink-0 text-xl font-extrabold tracking-tight text-primary"
      >
        {APP_NAME}
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
            {item.label === "Dashboard" ? "Home" : item.label}
          </NavLink>
        ))}
        {more.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger className="text-sm font-medium text-white/80 outline-none hover:text-white">
              More
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="border-white/10 bg-[#181818]">
              {more.map((item) => (
                <DropdownMenuItem key={item.href} asChild>
                  <Link to={item.href}>{item.label}</Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </nav>

      <div className="ml-auto flex items-center gap-3">
        {searchOpen ? (
          <form onSubmit={submitSearch} className="relative">
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
            className="text-white hover:bg-white/10"
            onClick={() => setSearchOpen(true)}
            aria-label="Search"
          >
            <Search className="h-5 w-5" />
          </Button>
        )}
        <UserMenu compact />
      </div>
    </header>
  );
}
