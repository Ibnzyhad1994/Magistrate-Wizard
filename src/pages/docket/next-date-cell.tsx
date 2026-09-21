import { useEffect, useId, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { DateOnlyInput } from "@/components/common/date-only-input";
import { LoadingSpinner } from "@/components/common/loading-spinner";
import {
  useDocketMatterCategories,
  useSetDocketMatterNextDate,
  type SetNextDateResult,
} from "@/hooks/docket/use-docket-capacity";
import { useDocketEvents } from "@/hooks/docket/use-docket-events";
import { CapacityOverrideDialog } from "@/pages/docket/capacity-override-dialog";
import { HintTooltip } from "@/components/ui/tooltip";
import { formatDate, getLocalDateOnly } from "@/lib/utils";
import { NOT_SET } from "@/lib/empty-display";
import { sittingDayVerdict, nextSittingDay } from "@/lib/court-calendar";
import { useNonSittingDays } from "@/hooks/docket/use-court-calendar";

/**
 * The Next Date cell on the Docket board — click/tap it to set or change
 * the matter's next hearing date without leaving the working sheet. Not a
 * second date field: it writes through the same capacity-checked
 * set_docket_matter_next_date() RPC (0078) that also backs the Hearing
 * Progress dialog's own optional Next Date, so both stay perfectly in
 * sync — there is exactly one canonical Next Date, computed the same way
 * the board's own next_appearance column always has been (earliest
 * 'scheduled' docket_events row on or after today).
 */
export function NextDateCell({
  matterId,
  nextDate,
  matterCategoryId,
  courtId,
  districtId,
  canEdit,
}: {
  matterId: string;
  nextDate: string | null;
  matterCategoryId?: string | null;
  /** Scopes the non-sitting-day check to this matter's court. */
  courtId?: string | null;
  districtId?: string | null;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (!canEdit) {
    return (
      <span className="whitespace-nowrap text-xs text-foreground/70">
        {nextDate ? formatDate(nextDate) : NOT_SET}
      </span>
    );
  }

  return (
    <>
      <HintTooltip
        label={
          nextDate
            ? `Change next date, currently ${formatDate(nextDate)}`
            : "Click to set the next hearing date"
        }
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="whitespace-nowrap rounded-md px-1.5 py-1 text-left text-xs font-medium text-foreground/70 underline decoration-dotted underline-offset-2 hover:bg-foreground/10 hover:text-foreground"
          aria-label={
            nextDate ? `Change next date, currently ${formatDate(nextDate)}` : "Set next date"
          }
        >
          {nextDate ? formatDate(nextDate) : "+ Set date"}
        </button>
      </HintTooltip>
      {open && (
        <NextDateDialog
          courtId={courtId}
          districtId={districtId}
          matterId={matterId}
          currentDate={nextDate}
          matterCategoryId={matterCategoryId ?? null}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export function NextDateDialog({
  matterId,
  currentDate,
  matterCategoryId,
  courtId,
  districtId,
  onClose,
  onSaved,
}: {
  matterId: string;
  currentDate: string | null;
  matterCategoryId: string | null;
  /** Scopes the non-sitting-day check; omitted means national rules only. */
  courtId?: string | null;
  districtId?: string | null;
  onClose: () => void;
  /**
   * Fired with the date that was actually scheduled, once the RPC has
   * accepted it (including after a capacity override). The callover
   * running sheet uses this to mirror the result onto its own item row —
   * the scheduling itself still happens only through
   * set_docket_matter_next_date(), never by writing the date directly.
   */
  onSaved?: (scheduledDate: string) => void;
}) {
  const { data: categories } = useDocketMatterCategories();
  const setNextDate = useSetDocketMatterNextDate();
  const fieldId = useId();
  // Carrying the previous appearance's category forward by default is
  // what actually fixes the reported "capacity shows 0/3 while matters
  // are visibly scheduled" bug in practice — every prior appearance that
  // HAD a category was silently losing it on the next adjournment,
  // because the category field defaulted to blank on every reschedule.
  const { data: events } = useDocketEvents(matterId);
  const currentAppearance = (events ?? []).find(
    (e) => e.event_status === "scheduled" && e.scheduled_date === currentDate,
  );

  const [date, setDate] = useState(currentDate ?? getLocalDateOnly());
  const [categoryId, setCategoryId] = useState("");
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [pendingOverride, setPendingOverride] = useState<SetNextDateResult | null>(null);
  const isPastDate = Boolean(date) && date < getLocalDateOnly();
  const { data: nonSittingDays } = useNonSittingDays();
  const scope = { courtId: courtId ?? null, districtId: districtId ?? null };
  const verdict = date ? sittingDayVerdict(date, scope, nonSittingDays ?? []) : null;
  const nextSitting =
    verdict && !verdict.sitting ? nextSittingDay(date, scope, nonSittingDays ?? []) : null;

  // events loads asynchronously, so the category can't be known at the
  // very first render — fill it in once it arrives, but only if the
  // magistrate hasn't already deliberately picked something themselves.
  useEffect(() => {
    if (categoryTouched) return;
    if (currentAppearance?.category_id) {
      setCategoryId(currentAppearance.category_id);
      return;
    }
    if (matterCategoryId) setCategoryId(matterCategoryId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentAppearance?.category_id, matterCategoryId]);

  async function submit(acknowledgeOverride: boolean, overrideReason: string | null) {
    const result = await setNextDate.mutateAsync({
      docketMatterId: matterId,
      scheduledDate: date,
      categoryId: categoryId || null,
      acknowledgeOverride,
      overrideReason,
    });
    if (result.status === "capacity_reached") {
      setPendingOverride(result);
      return;
    }
    onSaved?.(date);
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{currentDate ? "Change next date" : "Set next date"}</DialogTitle>
          <DialogDescription>Set when this matter is next in court.</DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <label
            htmlFor={`${fieldId}-date`}
            className="block text-xs font-medium text-muted-foreground"
          >
            Date
          </label>
          <DateOnlyInput
            id={`${fieldId}-date`}
            value={date}
            onChange={setDate}
            aria-label="Next date"
            aria-describedby={isPastDate ? `${fieldId}-past` : undefined}
          />
          {/* set_docket_matter_next_date() always supersedes the earliest
              appearance on or after today, so a date in the past does not
              rewrite history -- it cancels the NEXT hearing and files a
              scheduled row behind today. Warn rather than block: a
              magistrate correcting a mis-keyed year has a legitimate
              reason to continue. */}
          {isPastDate && (
            <p id={`${fieldId}-past`} className="text-xs text-warning">
              {formatDate(date)} is in the past. Saving would cancel the next hearing and leave no
              future date.
            </p>
          )}
          {/* Advisory only. A magistrate may lawfully sit on a holiday --
              urgent bail, remand returns, an emergency protection order --
              so this never blocks the save, and it is not stricter than
              the capacity limit, which only warns. */}
          {verdict && !verdict.sitting && !isPastDate && (
            <p className="text-xs text-warning">
              {formatDate(date)} is {verdict.reason}. The court does not normally sit that day.
              {nextSitting ? (
                <>
                  {" "}
                  <button
                    type="button"
                    className="underline underline-offset-2 hover:text-foreground"
                    onClick={() => setDate(nextSitting)}
                  >
                    Use {formatDate(nextSitting)} instead
                  </button>
                </>
              ) : null}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor={`${fieldId}-category`}
            className="block text-xs font-medium text-muted-foreground"
          >
            Matter category (optional, only checked against capacity if set)
          </label>
          <Select
            id={`${fieldId}-category`}
            value={categoryId}
            onChange={(e) => {
              setCategoryId(e.target.value);
              setCategoryTouched(true);
            }}
          >
            <option value="">No category (not capacity-checked)</option>
            {(categories ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={setNextDate.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void submit(false, null)}
            disabled={setNextDate.isPending || !date}
          >
            {setNextDate.isPending && <LoadingSpinner className="text-current" size={16} />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>

      {pendingOverride && (
        <CapacityOverrideDialog
          info={pendingOverride}
          scheduledDate={date}
          isPending={setNextDate.isPending}
          onCancel={() => setPendingOverride(null)}
          onConfirm={(reason) => void submit(true, reason)}
          onDateSuggested={setDate}
        />
      )}
    </Dialog>
  );
}
