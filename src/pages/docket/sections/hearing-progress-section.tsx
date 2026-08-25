import { useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Gavel, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { InlineError } from "@/components/common/inline-error";
import { LoadingSpinner } from "@/components/common/loading-spinner";
import { ControlledVocabSelect } from "@/components/common/controlled-vocab-select";
import { DateOnlyInput } from "@/components/common/date-only-input";
import { z } from "zod";
import {
  useDocketEvents,
  useCreateDocketEvent,
  useUpdateDocketEvent,
} from "@/hooks/docket/use-docket-events";
import {
  useDocketMatterCategories,
  useSetDocketMatterNextDate,
  type SetNextDateResult,
} from "@/hooks/docket/use-docket-capacity";
import { CapacityOverrideDialog } from "@/pages/docket/capacity-override-dialog";
import { Select } from "@/components/ui/select";
import { useDocketMatterAccess } from "@/hooks/docket/use-docket-matter-access";
import { EVENT_STAGES } from "@/lib/validations/docket";
import { matterCurrentStage, PROCEDURE_STAGE_LABELS } from "@/lib/docket-procedure";
import { formatDate, getLocalDateOnly } from "@/lib/utils";
import type { DocketEvent, DocketMatter } from "@/types/database.types";

/** A "hearing progress" entry is any docket_events row where at least one witness field has been recorded — the same table the Events tab reads, filtered/presented for trial-narrative purposes rather than scheduling logistics. */
function hasProgressData(e: DocketEvent): boolean {
  return (
    e.witnesses_called != null ||
    e.witnesses_completed != null ||
    e.witnesses_partly_heard != null ||
    e.witnesses_remaining != null
  );
}

interface Summary {
  hearings: number;
  witnessesCompleted: number | null;
  currentlyPartlyHeard: number | null;
  witnessesRemaining: number | null;
  lastEvidenceDate: string | null;
}

function summarize(entries: DocketEvent[]): Summary {
  if (entries.length === 0) {
    return {
      hearings: 0,
      witnessesCompleted: null,
      currentlyPartlyHeard: null,
      witnessesRemaining: null,
      lastEvidenceDate: null,
    };
  }
  // Ascending by hearing date — last element is the most recent sitting.
  const sorted = [...entries].sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date));
  const withCompleted = sorted.filter((e) => e.witnesses_completed != null);
  const totalCompleted = withCompleted.length
    ? withCompleted.reduce((sum, e) => sum + (e.witnesses_completed as number), 0)
    : null;
  const mostRecentPartlyHeard = [...sorted].reverse().find((e) => e.witnesses_partly_heard != null);
  const mostRecentRemaining = [...sorted].reverse().find((e) => e.witnesses_remaining != null);
  return {
    hearings: sorted.length,
    witnessesCompleted: totalCompleted,
    currentlyPartlyHeard: mostRecentPartlyHeard?.witnesses_partly_heard ?? null,
    witnessesRemaining: mostRecentRemaining?.witnesses_remaining ?? null,
    lastEvidenceDate: sorted[sorted.length - 1].scheduled_date,
  };
}

const progressSchema = z.object({
  scheduled_date: z.string().min(1, "Date is required"),
  stage_at_event: z.string().optional().or(z.literal("")),
  witnesses_called: z.string().optional().or(z.literal("")),
  witnesses_completed: z.string().optional().or(z.literal("")),
  witnesses_partly_heard: z.string().optional().or(z.literal("")),
  witnesses_remaining: z.string().optional().or(z.literal("")),
  outcome_at_event: z.string().optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
});
type ProgressFormValues = z.infer<typeof progressSchema>;

function toIntOrNull(v: string | undefined): number | null {
  const t = (v ?? "").trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export function HearingProgressSection({ matter }: { matter: DocketMatter }) {
  const { data, isPending, isError, error, refetch } = useDocketEvents(matter.id);
  const { data: access } = useDocketMatterAccess(matter.id);
  const canEdit = access?.canEdit ?? false;
  const [dialogEntry, setDialogEntry] = useState<DocketEvent | "new" | null>(null);

  const progressEntries = useMemo(() => (data ?? []).filter(hasProgressData), [data]);
  const summary = useMemo(() => summarize(progressEntries), [progressEntries]);
  const nextDate = useMemo(() => {
    const today = getLocalDateOnly();
    const upcoming = (data ?? [])
      .filter((e) => e.event_status === "scheduled" && e.scheduled_date >= today)
      .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date));
    return upcoming[0]?.scheduled_date ?? null;
  }, [data]);

  // Every real appearance (0080's "appearance history"), not just ones
  // with witness data recorded — a bare future "Scheduled" sitting with
  // nothing entered yet still belongs in the chronological hearing
  // history. entered_in_error rows are excluded (they were never really
  // on the docket). Ascending — earliest appearance first.
  const allAppearances = useMemo(
    () =>
      (data ?? [])
        .filter((e) => e.event_status !== "entered_in_error")
        .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date)),
    [data],
  );

  // Carrying the matter's most recent category forward by default is what
  // actually fixes "capacity shows 0/3 while matters are visibly
  // scheduled" in practice — every prior appearance that HAD a category
  // was silently losing it on the next reschedule, since the field
  // defaulted to blank every time.
  const lastCategoryId = useMemo(() => {
    const withCategory = (data ?? [])
      .filter((e) => e.category_id)
      .sort((a, b) => b.scheduled_date.localeCompare(a.scheduled_date));
    return withCategory[0]?.category_id ?? null;
  }, [data]);

  return (
    <Card className="lg:col-span-3">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Hearing / Trial Progress</CardTitle>
        {canEdit && (
          <Button size="sm" onClick={() => setDialogEntry("new")}>
            <Plus className="h-4 w-4" />
            Record hearing progress
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : isError ? (
          <InlineError error={error} onRetry={() => void refetch()} />
        ) : (
          <>
            {progressEntries.length > 0 && (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-md border border-border p-3 text-sm sm:grid-cols-4">
                <SummaryItem label="Hearings" value={String(summary.hearings)} />
                <SummaryItem
                  label="Witnesses completed"
                  value={summary.witnessesCompleted != null ? String(summary.witnessesCompleted) : "Not recorded"}
                />
                <SummaryItem
                  label="Currently partly heard"
                  value={summary.currentlyPartlyHeard != null ? String(summary.currentlyPartlyHeard) : "Not recorded"}
                />
                <SummaryItem
                  label="Witnesses remaining"
                  value={summary.witnessesRemaining != null ? String(summary.witnessesRemaining) : "Not recorded"}
                />
                <SummaryItem
                  label="Last evidence date"
                  value={summary.lastEvidenceDate ? formatDate(summary.lastEvidenceDate) : "Not recorded"}
                />
                <SummaryItem label="Next date" value={nextDate ? formatDate(nextDate) : "Not recorded"} />
              </div>
            )}

            {allAppearances.length === 0 ? (
              <EmptyState
                icon={Gavel}
                className="border-0 py-6"
                title="No hearing history recorded yet"
                description="Every date this matter is scheduled or heard builds a chronological hearing history here — witness numbers and sitting notes when entered, or just the date and status otherwise."
                action={
                  canEdit ? (
                    <Button size="sm" onClick={() => setDialogEntry("new")}>
                      <Plus className="h-4 w-4" />
                      Record today's progress
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <div className="space-y-3">
                {allAppearances.map((entry) => (
                  <div
                    key={entry.id}
                    className={`rounded-md border border-border p-3 ${canEdit ? "cursor-pointer hover:bg-muted/40" : ""}`}
                    onClick={canEdit ? () => setDialogEntry(entry) : undefined}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-foreground">
                        {formatDate(entry.scheduled_date)}
                        {entry.stage_at_event ? ` — ${entry.stage_at_event}` : ""}
                      </p>
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                          entry.event_status === "scheduled"
                            ? "bg-primary/20 text-primary"
                            : entry.event_status === "completed"
                              ? "bg-muted text-muted-foreground"
                              : "bg-muted/50 text-muted-foreground"
                        }`}
                      >
                        {entry.event_status === "scheduled"
                          ? "Scheduled"
                          : entry.event_status === "completed"
                            ? "Heard / Adjourned"
                            : "Rescheduled"}
                      </span>
                    </div>
                    {!hasProgressData(entry) && !entry.outcome_at_event && !entry.notes ? (
                      <p className="mt-1 text-xs italic text-muted-foreground">No proceedings details recorded.</p>
                    ) : (
                      <>
                        {hasProgressData(entry) && (
                          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                            {entry.witnesses_called != null && <span>Witnesses called: {entry.witnesses_called}</span>}
                            {entry.witnesses_completed != null && (
                              <span>Completed evidence: {entry.witnesses_completed}</span>
                            )}
                            {entry.witnesses_partly_heard != null && (
                              <span>Partly heard: {entry.witnesses_partly_heard}</span>
                            )}
                            {entry.witnesses_remaining != null && (
                              <span>Remaining: {entry.witnesses_remaining}</span>
                            )}
                          </div>
                        )}
                        {entry.outcome_at_event && (
                          <p className="mt-1 text-sm text-muted-foreground">{entry.outcome_at_event}</p>
                        )}
                        {entry.notes && <p className="mt-0.5 text-sm text-muted-foreground">{entry.notes}</p>}
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>

      {dialogEntry && (
        <HearingProgressDialog
          matterId={matter.id}
          entry={dialogEntry === "new" ? null : dialogEntry}
          defaultDate={nextDate ?? getLocalDateOnly()}
          defaultStage={PROCEDURE_STAGE_LABELS[matterCurrentStage(matter)]}
          defaultNextDateCategoryId={lastCategoryId}
          onClose={() => setDialogEntry(null)}
        />
      )}
    </Card>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-medium text-foreground">{value}</p>
    </div>
  );
}

function HearingProgressDialog({
  matterId,
  entry,
  defaultDate,
  defaultStage,
  defaultNextDateCategoryId,
  onClose,
}: {
  matterId: string;
  entry: DocketEvent | null;
  defaultDate: string;
  defaultStage: string;
  defaultNextDateCategoryId: string | null;
  onClose: () => void;
}) {
  const createEvent = useCreateDocketEvent(matterId);
  const updateEvent = useUpdateDocketEvent(matterId);
  const setNextDate = useSetDocketMatterNextDate();
  const { data: categories } = useDocketMatterCategories();
  const isPending = createEvent.isPending || updateEvent.isPending || setNextDate.isPending;

  // Optional, separate from the hearing-progress entry itself — saving it
  // writes through the SAME capacity-checked set_docket_matter_next_date()
  // RPC (0078) the Docket board's inline Next Date editor uses, so this is
  // a second workflow into the one canonical Next Date, never a competing
  // field. Left blank, nothing next-date-related happens. The category
  // defaults to the matter's own most recent category (see
  // HearingProgressSection's lastCategoryId) rather than blank, so a
  // routine adjournment doesn't silently drop out of capacity tracking.
  const [nextDateValue, setNextDateValue] = useState("");
  const [nextDateCategoryId, setNextDateCategoryId] = useState(defaultNextDateCategoryId ?? "");
  const [pendingOverride, setPendingOverride] = useState<SetNextDateResult | null>(null);

  const form = useForm<ProgressFormValues>({
    resolver: zodResolver(progressSchema),
    defaultValues: {
      scheduled_date: entry?.scheduled_date ?? defaultDate,
      stage_at_event: entry?.stage_at_event ?? defaultStage,
      witnesses_called: entry?.witnesses_called != null ? String(entry.witnesses_called) : "",
      witnesses_completed: entry?.witnesses_completed != null ? String(entry.witnesses_completed) : "",
      witnesses_partly_heard: entry?.witnesses_partly_heard != null ? String(entry.witnesses_partly_heard) : "",
      witnesses_remaining: entry?.witnesses_remaining != null ? String(entry.witnesses_remaining) : "",
      outcome_at_event: entry?.outcome_at_event ?? "",
      notes: entry?.notes ?? "",
    },
  });

  async function saveNextDateIfSet(acknowledgeOverride = false, overrideReason: string | null = null) {
    if (!nextDateValue) return true; // nothing to do — not an error
    const result = await setNextDate.mutateAsync({
      docketMatterId: matterId,
      scheduledDate: nextDateValue,
      categoryId: nextDateCategoryId || null,
      acknowledgeOverride,
      overrideReason,
    });
    if (result.status === "capacity_reached") {
      setPendingOverride(result);
      return false;
    }
    return true;
  }

  async function onSubmit(values: ProgressFormValues) {
    const payload = {
      scheduled_date: values.scheduled_date,
      stage_at_event: values.stage_at_event || null,
      witnesses_called: toIntOrNull(values.witnesses_called),
      witnesses_completed: toIntOrNull(values.witnesses_completed),
      witnesses_partly_heard: toIntOrNull(values.witnesses_partly_heard),
      witnesses_remaining: toIntOrNull(values.witnesses_remaining),
      outcome_at_event: values.outcome_at_event || null,
      notes: values.notes || null,
      // Recording what already happened at a sitting — 'completed' unless
      // editing an existing entry, whose own status is left untouched.
      ...(entry ? {} : { event_status: "completed" as const }),
    };
    try {
      if (entry) {
        await updateEvent.mutateAsync({ id: entry.id, values: payload });
      } else {
        await createEvent.mutateAsync(payload);
      }
      // The sitting record is saved regardless of what happens next — a
      // capacity warning on the Next Date must never lose the proceedings
      // note the magistrate just entered.
      const nextDateOk = await saveNextDateIfSet();
      if (nextDateOk) onClose();
    } catch {
      // Surfaced globally via the mutation cache toast subscriber.
    }
  }

  async function onConfirmNextDateOverride(reason: string | null) {
    const ok = await saveNextDateIfSet(true, reason);
    if (ok) onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{entry ? "Edit hearing progress" : "Record hearing progress"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="scheduled_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Hearing date</FormLabel>
                    <FormControl>
                      <DateOnlyInput
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        aria-label="Hearing date"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="stage_at_event"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Stage / hearing type</FormLabel>
                    <FormControl>
                      <ControlledVocabSelect
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        options={EVENT_STAGES}
                        placeholder="Select stage…"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <FormField
                control={form.control}
                name="witnesses_called"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Called</FormLabel>
                    <FormControl>
                      <Input type="number" min={0} step={1} placeholder="—" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="witnesses_completed"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Completed</FormLabel>
                    <FormControl>
                      <Input type="number" min={0} step={1} placeholder="—" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="witnesses_partly_heard"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Partly heard</FormLabel>
                    <FormControl>
                      <Input type="number" min={0} step={1} placeholder="—" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="witnesses_remaining"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Remaining</FormLabel>
                    <FormControl>
                      <Input type="number" min={0} step={1} placeholder="—" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Leave any of the above blank if not known — a blank field is kept as "not recorded", never assumed to
              be zero.
            </p>

            <FormField
              control={form.control}
              name="outcome_at_event"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Witnesses / details (optional)</FormLabel>
                  <FormControl>
                    <Textarea rows={2} placeholder="e.g. PW1 John Thomas — completed; PW2 Mary Singh — partly heard" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Proceedings notes (optional)</FormLabel>
                  <FormControl>
                    <Textarea rows={2} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-2 rounded-md border border-border p-3">
              <p className="text-xs font-medium text-foreground">Next date (optional)</p>
              <p className="text-xs text-muted-foreground">
                If the matter was adjourned to a new date, set it here — same as setting it from the Docket board.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <DateOnlyInput value={nextDateValue} onChange={setNextDateValue} aria-label="Next date" />
                <Select
                  value={nextDateCategoryId}
                  onChange={(e) => setNextDateCategoryId(e.target.value)}
                  disabled={!nextDateValue}
                >
                  <option value="">No category — not capacity-checked</option>
                  {(categories ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending && <LoadingSpinner className="text-current" size={16} />}
                {entry ? "Save changes" : "Record progress"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>

      {pendingOverride && (
        <CapacityOverrideDialog
          info={pendingOverride}
          scheduledDate={nextDateValue}
          isPending={setNextDate.isPending}
          onCancel={() => setPendingOverride(null)}
          onConfirm={(reason) => void onConfirmNextDateOverride(reason)}
          onDateSuggested={setNextDateValue}
        />
      )}
    </Dialog>
  );
}
