import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface MobileSearchDialogProps {
  open: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: (event: React.FormEvent) => void;
}

export function MobileSearchDialog({
  open,
  query,
  onQueryChange,
  onOpenChange,
  onSubmit,
}: MobileSearchDialogProps) {
  const handleCancel = () => onOpenChange(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        overlayClassName="z-[70] bg-black/55 backdrop-blur-md"
        className="z-[70] top-[16%] w-[calc(100%-1.25rem)] max-w-lg translate-y-0 gap-5 rounded-2xl border-white/25 bg-black/45 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop-blur-2xl backdrop-saturate-150 sm:rounded-2xl data-[state=closed]:slide-out-to-top-4 data-[state=open]:slide-in-from-top-4"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-[hsl(var(--brass))] to-transparent opacity-80"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-b from-white/[0.16] via-transparent to-black/25"
        />
        <DialogHeader className="relative pr-8 text-left">
          <DialogTitle className="font-brand text-xl font-semibold tracking-[0.08em]">
            Search
          </DialogTitle>
          <DialogDescription className="text-white/70">
            Find docket matters, judgments, notes, case law, and legislation.
          </DialogDescription>
        </DialogHeader>
        <form id="mobile-search-form" onSubmit={onSubmit} className="relative space-y-1">
          <label htmlFor="mobile-search-input" className="sr-only">
            Search
          </label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/55"
              aria-hidden="true"
            />
            <Input
              id="mobile-search-input"
              autoFocus
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Titles, notes, legislation…"
              className="h-12 rounded-lg border-white/25 bg-black/25 pl-10 text-base text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] placeholder:text-white/45 focus-visible:border-white/40 focus-visible:ring-white/30"
              autoComplete="off"
              enterKeyHint="search"
            />
          </div>
        </form>
        <DialogFooter className="relative border-white/10 bg-transparent">
          <Button type="button" variant="more" onClick={handleCancel}>
            Cancel
          </Button>
          <Button type="submit" form="mobile-search-form" variant="play">
            Search
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
