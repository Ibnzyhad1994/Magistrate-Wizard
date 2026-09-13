import { useRef } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useIsDesktop } from "@/hooks/use-media-query";

interface NavSearchProps {
  open: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  onOpen: () => void;
  onClose: () => void;
  onSubmit: (event: React.FormEvent) => void;
  buttonClassName?: string;
}

/**
 * Header search: icon when closed, an inline field when open.
 * Never a dialog — the page stays visible underneath.
 */
export function NavSearch({
  open,
  query,
  onQueryChange,
  onOpen,
  onClose,
  onSubmit,
  buttonClassName,
}: NavSearchProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const isDesktop = useIsDesktop();

  const handleClose = () => {
    onClose();
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  if (!open) {
    return (
      <Button
        ref={triggerRef}
        variant="ghost"
        size="icon"
        className={cn("min-h-11 min-w-11 shrink-0 touch-manipulation", buttonClassName)}
        onClick={onOpen}
        aria-label="Search"
        aria-expanded={false}
        data-tour="nav-search"
      >
        <Search className="h-5 w-5" />
      </Button>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="relative flex min-w-0 flex-1 items-center lg:flex-none"
      role="search"
    >
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        autoFocus
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onBlur={() => {
          if (isDesktop && !query) onClose();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            handleClose();
            return;
          }
          if (event.key !== "Enter") return;
          event.preventDefault();
          event.currentTarget.form?.requestSubmit();
        }}
        placeholder="Titles, notes, legislation…"
        className="h-11 min-w-0 flex-1 border-input bg-secondary pl-8 pr-10 text-base text-foreground placeholder:text-muted-foreground lg:h-9 lg:w-64 lg:flex-none lg:text-sm"
        aria-label="Search"
        autoComplete="off"
        enterKeyHint="search"
        data-tour="nav-search"
      />
      <button type="submit" tabIndex={-1} className="sr-only">
        Search
      </button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute right-0.5 top-1/2 h-9 w-9 min-h-9 min-w-9 -translate-y-1/2 shrink-0 touch-manipulation text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
        onMouseDown={(event) => event.preventDefault()}
        onClick={handleClose}
        aria-label="Close search"
      >
        <X className="h-4 w-4" />
      </Button>
    </form>
  );
}
