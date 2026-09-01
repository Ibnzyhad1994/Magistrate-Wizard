import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { formatDate, getLocalDateOnly } from "@/lib/utils";

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
  canEdit,
}: {
  matterId: string;
  nextDate: string | null;
  matterCategoryId?: string | null;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (!canEdit) {
    return <span className="whitespace-nowrap text-xs text-white/70">{nextDate ? formatDate(nextDate) : "—"}</span>;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="whitespace-nowrap rounded px-1.5 py-1 text-left text-xs font-medium text-white/70 underline decoration-dotted underline-offset-2 hover:bg-white/10 hover:text-white"
        aria-label={nextDate ? `Change next date, currently ${formatDate(nextDate)}` : "Set next date"}
      >
        {nextDate ? formatDate(nextDate) : "+ Set date"}
      </button>
      {open && (
        <NextDateDialog
          matterId={matterId}
          currentDate={nextDate}
          matterCategoryId={matterCategoryId ?? null}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function NextDateDialog({
  matterId,
  currentDate,
  matterCategoryId,
  onClose,
}: {
  matterId: string;
  currentDate: string | null;
  matterCategoryId: string | null;
  onClose: () => void;
}) {
  const { data: categories } = useDocketMatterCategories();
  const setNextDate = useSetDocketMatterNextDate();
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
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{currentDate ? "Change next date" : "Set next date"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-muted-foreground">Date</label>
          <DateOnlyInput value={date} onChange={setDate} aria-label="Next date" />
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs font-medium text-muted-foreground">
            Matter category (optional, only checked against capacity if set)
          </label>
          <Select
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
          <Button type="button" variant="outline" onClick={onClose} disabled={setNextDate.isPending}>
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
