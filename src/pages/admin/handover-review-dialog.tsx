import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RelinquishPreflightSummary } from "@/components/court-handover/relinquish-preflight";
import { useRelinquishPreflight } from "@/hooks/use-court-handover";
import type { PinnedJudgment, RelinquishPreflight } from "@/lib/court-handover";

interface HandoverReviewDialogProps {
  /** An ended magistrate assignment from a person's History. */
  assignment: { id: string; courtName: string } | null;
  onOpenChange: (open: boolean) => void;
  renderTransfer: (pin: PinnedJudgment, preflight: RelinquishPreflight) => ReactNode;
}

/**
 * Administrator: what a departed magistrate's ended assignment left behind,
 * metadata only, with the transfer action for each judgment pinned there.
 */
export function HandoverReviewDialog({
  assignment,
  onOpenChange,
  renderTransfer,
}: HandoverReviewDialogProps) {
  const preflight = useRelinquishPreflight(assignment?.id ?? null);
  return (
    <Dialog open={!!assignment} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Hand-over: {assignment?.courtName}</DialogTitle>
          <DialogDescription>
            Part-heard matters and judgment links at this court from this assignment.
          </DialogDescription>
        </DialogHeader>
        <RelinquishPreflightSummary
          preflight={preflight}
          mode="admin"
          renderTransfer={renderTransfer}
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
