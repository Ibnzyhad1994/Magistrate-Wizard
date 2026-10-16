import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { DateOnlyInput } from "@/components/common/date-only-input";
import { CreateDocketMatterDialog } from "@/pages/docket/create-docket-matter-dialog";
import { CapacityOverrideDialog } from "@/pages/docket/capacity-override-dialog";
import { useListCalloverMatter } from "@/hooks/docket/use-callovers";
import type { CapacityReached, ListCalloverMatterInput } from "@/lib/callover-schedule";
import { procedureStageLabel } from "@/lib/docket-procedure";
import { formatDate } from "@/lib/utils";
import type { Tables } from "@/types/database.types";

/**
 * Callover intake: the ordinary matter form with the "already in
 * progress" section open and a listing date, so a matter that predates
 * the docket is entered straight onto that day's schedule. The matter is
 * listed through the shared capacity check and then recorded on that
 * day's callover sheet, so the Callover screens keep working unchanged.
 */
export function CalloverMatterDialog({
  open,
  onOpenChange,
  defaultCourtId,
  date: fixedDate,
  defaultDate,
  calloverId,
  onListed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultCourtId?: string | null;
  /** The sitting's own date when entered on a callover sheet; the field is then read-only. */
  date?: string;
  /** The day the field starts on when the date is the magistrate's choice. */
  defaultDate?: string;
  calloverId?: string;
  onListed?: (date: string) => void;
}) {
  const fieldId = useId();
  const initialDate = fixedDate ?? defaultDate ?? "";
  const [date, setDate] = useState(initialDate);
  const [pending, setPending] = useState<{
    input: ListCalloverMatterInput;
    capacity: CapacityReached;
  } | null>(null);
  const listMatter = useListCalloverMatter();

  useEffect(() => {
    if (open) setDate(initialDate);
  }, [open, initialDate]);

  async function list(input: ListCalloverMatterInput) {
    const result = await listMatter.mutateAsync(input);
    if (result.status === "capacity_reached") {
      setPending({ input, capacity: result });
      return;
    }
    setPending(null);
    toast.success(`Listed on ${formatDate(input.date)}.`);
    onListed?.(input.date);
  }

  function handleCreated(matter: Tables<"docket_matters">) {
    void list({
      matterId: matter.id,
      courtId: matter.court_id,
      date: date || initialDate,
      categoryId: matter.category_id,
      stageAtEvent: matter.procedure_stage ? procedureStageLabel(matter.procedure_stage) : null,
      calloverId,
    }).catch(() => {
      // Surfaced by the mutation's own error toast.
    });
  }

  return (
    <>
      <CreateDocketMatterDialog
        open={open}
        onOpenChange={onOpenChange}
        defaultCourtId={defaultCourtId}
        defaultBroughtForward
        title="Add a callover matter"
        description="A matter already under way before this docket. It is listed on the day below."
        onCreated={handleCreated}
        extraFields={
          <div className="space-y-1.5">
            <label htmlFor={`${fieldId}-date`} className="block text-sm font-medium">
              Listed on
            </label>
            {fixedDate ? (
              <p
                id={`${fieldId}-date`}
                className="flex min-h-11 items-center rounded-md border border-input bg-muted px-3 text-sm text-foreground lg:min-h-10"
              >
                {formatDate(fixedDate)}
              </p>
            ) : (
              <DateOnlyInput
                id={`${fieldId}-date`}
                value={date}
                onChange={setDate}
                aria-label="Listed on"
              />
            )}
            <p className="text-xs text-muted-foreground">
              It shows on that day&apos;s docket and calendar, marked Callover.
            </p>
          </div>
        }
      />
      {pending && (
        <CapacityOverrideDialog
          info={pending.capacity}
          scheduledDate={pending.input.date}
          isPending={listMatter.isPending}
          onCancel={() => {
            toast.warning(
              `The matter is saved but not listed on ${formatDate(pending.input.date)}. Set its date from the docket.`,
            );
            setPending(null);
          }}
          onConfirm={(reason) => {
            void list({
              ...pending.input,
              acknowledgeOverride: true,
              overrideReason: reason,
            }).catch(() => {
              // Surfaced by the mutation's own error toast.
            });
          }}
        />
      )}
    </>
  );
}
