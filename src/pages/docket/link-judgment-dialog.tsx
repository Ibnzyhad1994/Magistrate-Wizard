import { useMemo, useState } from "react";
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
import { useJudgments } from "@/hooks/judgments/use-judgments";
import { useCreateDocketJudgmentLink } from "@/hooks/docket/use-docket-judgment-links";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

interface LinkJudgmentDialogProps {
  matterId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Judgment ids already linked to this matter — excluded from the picker. */
  linkedJudgmentIds: string[];
}

/**
 * Picker for "Link Judgment" on a Docket Matter's Judgments tab. Sourced
 * from `useJudgments()` (owner-or-discoverable per that hook's own RLS),
 * then filtered client-side to Judgments OWNED by the caller — the live
 * `docket_matter_judgments` INSERT policy requires Judgment ownership
 * specifically, not mere discoverable-read access (see
 * use-docket-judgment-links.ts), so offering a non-owned discoverable
 * Judgment here would only produce a confusing RLS rejection. The
 * server re-checks ownership regardless of what this list shows.
 */
export function LinkJudgmentDialog({
  matterId,
  open,
  onOpenChange,
  linkedJudgmentIds,
}: LinkJudgmentDialogProps) {
  const [search, setSearch] = useState("");
  const { user } = useAuth();
  const { data, isPending } = useJudgments();
  const createLink = useCreateDocketJudgmentLink(matterId);

  const ownedJudgments = useMemo(
    () => (data ?? []).filter((j) => j.owner_id === user?.id),
    [data, user?.id],
  );

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ownedJudgments.filter((j) => {
      if (linkedJudgmentIds.includes(j.id)) return false;
      if (!q) return true;
      return (
        j.title.toLowerCase().includes(q) ||
        (j.case_number ?? "").toLowerCase().includes(q) ||
        (j.citation ?? "").toLowerCase().includes(q)
      );
    });
  }, [ownedJudgments, linkedJudgmentIds, search]);

  function handleClose() {
    setSearch("");
    onOpenChange(false);
  }

  function handleLink(judgmentId: string) {
    createLink.mutate(judgmentId, {
      onSuccess: () => handleClose(),
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && handleClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Link Judgment</DialogTitle>
          <DialogDescription>
            Select one of your own Judgments to link as reference material
            for this matter. Only Judgments you own can be linked.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title, case number, or citation…"
            className="pl-8"
            aria-label="Search your judgments"
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
                  ? "No matching judgments"
                  : ownedJudgments.length === 0
                    ? "You don't own any Judgments yet"
                    : "All matching judgments are already linked"
              }
              description={
                search
                  ? "Try a different title, case number, or citation."
                  : "Create a Judgment in the Judgment workspace, then link it here."
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {candidates.map((j) => (
                <li key={j.id}>
                  <button
                    type="button"
                    disabled={createLink.isPending}
                    onClick={() => handleLink(j.id)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 px-1 py-2 text-left text-sm hover:bg-muted/40",
                      "disabled:pointer-events-none disabled:opacity-50",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-foreground">
                        {j.title}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[j.case_number, j.citation].filter(Boolean).join(" · ") || "—"}
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
