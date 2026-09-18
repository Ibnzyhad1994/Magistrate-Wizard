import { useId, useMemo, useState } from "react";
import { toast } from "sonner";
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
import { DateOnlyInput } from "@/components/common/date-only-input";
import { LoadingSpinner } from "@/components/common/loading-spinner";
import {
  bucketByCategory,
  forecastCapacity,
  summariseBulk,
  type BulkOutcome,
  type SelectableRow,
} from "@/lib/docket-selection";
import { sittingDayVerdict, nextSittingDay } from "@/lib/court-calendar";
import { useNonSittingDays } from "@/hooks/docket/use-court-calendar";
import { useBulkSetNextDate, useDocketCapacitySnapshot } from "@/hooks/docket/use-docket-capacity";
import { formatDate, getLocalDateOnly } from "@/lib/utils";

/**
 * Adjourns several files to one date.
 *
 * Only the next date is batched. Board stages are not: each column is
 * per-protocol, guarded by its own row version and prompts to log an
 * appearance, so batching that would corrupt thirty files at once. Matter
 * status is not either -- silently completing judicial files from a
 * dropdown is the wrong default (0129).
 */
export function DocketBulkAdjournDialog({
  rows,
  selected,
  courtId,
  districtId,
  onClose,
  onDone,
}: {
  rows: SelectableRow[];
  selected: ReadonlySet<string>;
  courtId: string | null;
  districtId: string | null;
  onClose: () => void;
  onDone: (remaining: Set<string>) => void;
}) {
  const fieldId = useId();
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [outcomes, setOutcomes] = useState<BulkOutcome[] | null>(null);
  const bulk = useBulkSetNextDate();
  const { data: nonSittingDays } = useNonSittingDays();
  const { data: snapshot } = useDocketCapacitySnapshot(date);

  const ids = useMemo(() => [...selected], [selected]);
  const categoryIdFor = (matterId: string) =>
    rows.find((row) => row.id === matterId)?.category_id ?? null;

  const forecast = useMemo(
    () => (date ? forecastCapacity(bucketByCategory(rows, selected), snapshot ?? []) : []),
    [date, rows, selected, snapshot],
  );
  const overflowing = forecast.filter((entry) => entry.over > 0);

  const scope = { courtId, districtId };
  const verdict = date ? sittingDayVerdict(date, scope, nonSittingDays ?? []) : null;
  const suggestion =
    verdict && !verdict.sitting ? nextSittingDay(date, scope, nonSittingDays ?? []) : null;
  const isPast = Boolean(date) && date < getLocalDateOnly();

  const run = async (acknowledgeOverride: boolean) => {
    const results = await bulk.mutateAsync({
      matterIds: ids,
      scheduledDate: date,
      categoryIdFor,
      acknowledgeOverride,
      overrideReason: acknowledgeOverride ? reason.trim() || null : null,
    });
    setOutcomes(results);
    const summary = summariseBulk(results, formatDate(date));
    if (summary.failed.length === 0) {
      toast.success(summary.sentence);
      onDone(new Set());
      onClose();
      return;
    }
    // Keep the failures selected so the retry is one click on exactly
    // those, rather than making the magistrate find them again.
    onDone(new Set(summary.failed.map((entry) => entry.matterId)));
  };

  const summary = outcomes ? summariseBulk(outcomes, formatDate(date)) : null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Adjourn {ids.length === 1 ? "1 matter" : `${ids.length} matters`}
          </DialogTitle>
          <DialogDescription>
            Sets the next date on each file through the same capacity-checked path as adjourning one
            at a time. Nothing else on the board changes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <label
            htmlFor={`${fieldId}-date`}
            className="block text-xs font-medium text-muted-foreground"
          >
            Adjourn to
          </label>
          <DateOnlyInput
            id={`${fieldId}-date`}
            value={date}
            onChange={setDate}
            aria-label="Adjourn to date"
          />
          {isPast && (
            <p className="text-xs text-warning">
              {formatDate(date)} has passed. Choose today or a later date.
            </p>
          )}
          {verdict && !verdict.sitting && !isPast && (
            <p className="text-xs text-warning">
              {formatDate(date)} is {verdict.reason}. The court does not normally sit that day.
              {suggestion ? (
                <>
                  {" "}
                  <button
                    type="button"
                    className="underline underline-offset-2 hover:text-foreground"
                    onClick={() => setDate(suggestion)}
                  >
                    Use {formatDate(suggestion)} instead
                  </button>
                </>
              ) : null}
            </p>
          )}
        </div>

        {/* "Your limit": the snapshot counts sittings this magistrate
            presides, which is not the same number as the day list below
            the board. Presenting them as comparable is the confusion
            0147 to 0148 had to correct. */}
        {overflowing.length > 0 && !isPast && (
          <div className="space-y-2 rounded-md border border-hairline bg-surface-2 p-3 text-sm hc:border-border">
            {overflowing.map((entry) => (
              <p key={entry.categoryId ?? "none"}>
                {entry.categoryName}: {entry.alreadyScheduled} already listed and {entry.selected}{" "}
                selected, against your limit of {entry.limit} on {formatDate(date)}.{" "}
                <span className="font-medium">
                  {entry.over === 1 ? "1 would be over" : `${entry.over} would be over`}.
                </span>
              </p>
            ))}
            <div className="space-y-1.5">
              <label
                htmlFor={`${fieldId}-reason`}
                className="block text-xs font-medium text-muted-foreground"
              >
                Reason for going over (recorded against your name)
              </label>
              <Input
                id={`${fieldId}-reason`}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="e.g. Part-heard trials must resume together"
                aria-label="Reason for exceeding your daily limit"
              />
            </div>
          </div>
        )}

        {summary && summary.failed.length > 0 && (
          <div className="space-y-1 rounded-md border border-hairline bg-surface-2 p-3 text-sm hc:border-border">
            <p className="font-medium">{summary.sentence}</p>
            <p className="text-xs text-muted-foreground">
              The ones that did not go through are still selected. Adjust the date, or give a reason
              to go over your limit, and try those again.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={bulk.isPending}>
            {summary ? "Close" : "Cancel"}
          </Button>
          <Button
            type="button"
            disabled={
              !date || isPast || bulk.isPending || (overflowing.length > 0 && !reason.trim())
            }
            onClick={() => void run(overflowing.length > 0)}
          >
            {bulk.isPending && <LoadingSpinner className="text-current" size={16} />}
            {overflowing.length > 0 ? "Adjourn anyway" : "Adjourn"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
