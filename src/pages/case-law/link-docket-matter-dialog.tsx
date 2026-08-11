import { useState } from "react";
import { Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { LoadingSpinner } from "@/components/common/loading-spinner";
import { useDocketMatters } from "@/hooks/docket/use-docket-matters";
import { useCreateCaseLawDocketLink } from "@/hooks/case-law/use-case-law-docket-links";
import { cn } from "@/lib/utils";

interface LinkDocketMatterDialogProps {
  caseLawId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Docket Matter ids already linked — excluded from the picker. */
  linkedMatterIds: string[];
}

/**
 * Picker for "Link to Docket Matter" on a Case Law entry. Sources
 * candidates from `useDocketMatters()` — the same RLS-scoped list the
 * Docket workspace itself uses (current Court access, retained
 * assignment, or an active share) — never an unscoped global list. The
 * live `docket_matter_case_law` INSERT policy is narrower than that
 * (Court or retained only, not share-based access) and remains the
 * final, authoritative gate: if a share-only matter is picked, the
 * insert is rejected server-side and surfaced as a plain error, exactly
 * like every other RLS-enforced action in this app.
 */
export function LinkDocketMatterDialog({
  caseLawId,
  open,
  onOpenChange,
  linkedMatterIds,
}: LinkDocketMatterDialogProps) {
  const [search, setSearch] = useState("");
  const { data, isPending } = useDocketMatters(search);
  const createLink = useCreateCaseLawDocketLink(caseLawId);

  const candidates = (data ?? []).filter((m) => !linkedMatterIds.includes(m.id));

  function handleClose() {
    setSearch("");
    onOpenChange(false);
  }

  function handleLink(matterId: string) {
    createLink.mutate(matterId, {
      onSuccess: () => handleClose(),
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && handleClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Link to Docket Matter</DialogTitle>
          <DialogDescription>
            Select a Docket Matter you have access to. This authority will
            appear in its Case Law tab.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search case number, title, or issue…"
            className="pl-8"
            aria-label="Search docket matters"
            autoFocus
          />
        </div>

        <div className="max-h-80 overflow-y-auto">
          {isPending ? (
            <div className="space-y-2 py-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : candidates.length === 0 ? (
            <EmptyState
              className="border-0 py-8"
              title={
                search
                  ? "No matching matters"
                  : (data?.length ?? 0) === 0
                    ? "No accessible Docket Matters"
                    : "All matching matters are already linked"
              }
              description={
                search
                  ? "Try a different case number, title, or issue."
                  : "You need current Court, retained, or shared access to a Docket Matter to link it."
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {candidates.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    disabled={createLink.isPending}
                    onClick={() => handleLink(m.id)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 px-1 py-2 text-left text-sm hover:bg-muted/40",
                      "disabled:pointer-events-none disabled:opacity-50",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-foreground">
                        {m.matter_title}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {m.case_number}
                      </span>
                    </span>
                    {createLink.isPending ? (
                      <LoadingSpinner size={16} />
                    ) : (
                      <span className="shrink-0 rounded-md border border-input px-2.5 py-1 text-xs font-medium text-foreground">
                        Link
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
