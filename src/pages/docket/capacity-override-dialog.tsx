import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { LoadingSpinner } from "@/components/common/loading-spinner";
import { useNextAvailableDocketDate } from "@/hooks/docket/use-docket-capacity";
import { formatDate } from "@/lib/utils";

interface CapacityReachedInfo {
  category_id: string | null;
  category_name: string | null;
  configured_capacity: number | null;
  scheduled_count: number | null;
}

/**
 * The "capacity reached" confirm step — same exact copy/behavior
 * ("Cancel / Choose Another Date" / "Add Anyway", optional reason,
 * "Suggest next available date") used by every entry point that can hit
 * a magistrate's configured capacity: the Add/Edit Event dialog, the
 * Docket board's inline Next Date editor, and the Hearing Progress
 * dialog's optional Next Date field. One implementation so the warning
 * behaves identically everywhere it appears, per the standing "never
 * silently overbook, always the same override workflow" requirement.
 */
export function CapacityOverrideDialog({
  info,
  scheduledDate,
  isPending,
  onCancel,
  onConfirm,
  onDateSuggested,
}: {
  info: CapacityReachedInfo;
  scheduledDate: string;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: (reason: string | null) => void;
  /** Lets the caller move the date instead of overriding — omit where there's nowhere sensible to write the suggestion back to (the suggest button is then hidden). */
  onDateSuggested?: (date: string) => void;
}) {
  const [reason, setReason] = useState("");
  const nextAvailable = useNextAvailableDocketDate();

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Capacity reached</DialogTitle>
          <DialogDescription>
            {info.scheduled_count} of {info.configured_capacity} {info.category_name} matters already scheduled for{" "}
            {formatDate(scheduledDate)}. Do you wish to add this matter anyway?
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1">
          <label className="block text-xs font-medium text-muted-foreground">Reason for override (optional)</label>
          <Textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Judge directed same-day hearing"
          />
        </div>

        <DialogFooter className="flex-wrap gap-2">
          {info.category_id && onDateSuggested && (
            <Button
              type="button"
              variant="ghost"
              disabled={nextAvailable.isPending}
              onClick={async () => {
                const suggested = await nextAvailable.mutateAsync({
                  categoryId: info.category_id as string,
                  startDate: scheduledDate,
                });
                if (suggested) onDateSuggested(suggested);
                onCancel();
              }}
            >
              {nextAvailable.isPending && <LoadingSpinner className="text-current" size={16} />}
              Suggest next available date
            </Button>
          )}
          <Button type="button" variant="outline" disabled={isPending} onClick={onCancel}>
            Cancel / Choose Another Date
          </Button>
          <Button type="button" disabled={isPending} onClick={() => onConfirm(reason.trim() || null)}>
            {isPending && <LoadingSpinner className="text-current" size={16} />}
            Add Anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
