import { Menu, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUiStore } from "@/store/ui-store";
import { useTheme } from "@/providers/use-theme";

interface HeaderProps {
  title?: string;
}

/**
 * Top app bar rendered inside `AppLayout`. Owns the mobile nav trigger
 * and the theme toggle; page-specific actions can be added via `title`
 * or by extending this component with a slot prop in a later phase.
 */
export function Header({ title }: HeaderProps) {
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen);
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-4">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={() => setMobileNavOpen(true)}
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" />
      </Button>

      <h1 className="flex-1 truncate text-sm font-semibold text-foreground">
        {title}
      </h1>

      <Button
        variant="ghost"
        size="icon"
        onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        aria-label="Toggle theme"
      >
        {resolvedTheme === "dark" ? (
          <Sun className="h-4 w-4" />
        ) : (
          <Moon className="h-4 w-4" />
        )}
      </Button>
    </header>
  );
}
