import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
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
import { LoadingSpinner } from "@/components/common/loading-spinner";
import { ControlledVocabSelect } from "@/components/common/controlled-vocab-select";
import { DateOnlyInput } from "@/components/common/date-only-input";
import {
  useDocketMatterCategories,
  useDocketCapacitySnapshot,
  useScheduleDocketEventWithCapacity,
  type ScheduleWithCapacityResult,
} from "@/hooks/docket/use-docket-capacity";
import { CapacityIndicator } from "@/pages/docket/capacity-indicator";
import { CapacityOverrideDialog } from "@/pages/docket/capacity-override-dialog";
import {
  DOCKET_EVENT_STATUSES,
  EVENT_STAGES,
  EVENT_TYPES,
  docketEventSchema,
  type DocketEventFormValues,
} from "@/lib/validations/docket";
import { getLocalDateOnly, toTitleCase } from "@/lib/utils";
import type { DocketEvent } from "@/types/database.types";

export function DocketEventDialog({
  matterId,
  event,
  onClose,
  defaults,
}: {
  matterId: string;
  event: DocketEvent | null;
  onClose: () => void;
  defaults?: Partial<DocketEventFormValues>;
}) {
  const schedule = useScheduleDocketEventWithCapacity(matterId);
  const { data: categories } = useDocketMatterCategories();
  const isPending = schedule.isPending;

  // The last capacity_reached result from a submit attempt, plus the
  // exact form values that produced it — kept so "Add Anyway" can
  // re-submit the identical booking with acknowledgeOverride: true
  // rather than re-reading a possibly-changed form.
  const [pendingOverride, setPendingOverride] = useState<{
    result: ScheduleWithCapacityResult;
    values: DocketEventFormValues;
  } | null>(null);

  const form = useForm<DocketEventFormValues>({
    resolver: zodResolver(docketEventSchema),
    defaultValues: {
      scheduled_date: event?.scheduled_date ?? defaults?.scheduled_date ?? getLocalDateOnly(),
      scheduled_time: event?.scheduled_time ?? defaults?.scheduled_time ?? "",
      event_type: event?.event_type ?? defaults?.event_type ?? "",
      location: event?.location ?? defaults?.location ?? "",
      stage_at_event: event?.stage_at_event ?? defaults?.stage_at_event ?? "",
      outcome_at_event: event?.outcome_at_event ?? defaults?.outcome_at_event ?? "",
      orders_made_at_event: event?.orders_made_at_event ?? defaults?.orders_made_at_event ?? "",
      notes: event?.notes ?? defaults?.notes ?? "",
      event_status:
        (event?.event_status as DocketEventFormValues["event_status"]) ??
        defaults?.event_status ??
        "scheduled",
      category_id: event?.category_id ?? defaults?.category_id ?? "",
    },
  });

  const watchedDate = form.watch("scheduled_date");
  const watchedCategoryId = form.watch("category_id");
  const { data: snapshot } = useDocketCapacitySnapshot(watchedDate || undefined);
  const activeSnapshot = (snapshot ?? []).find((s) => s.category_id === watchedCategoryId);

  async function submit(values: DocketEventFormValues, acknowledgeOverride: boolean, overrideReason: string | null) {
    const result = await schedule.mutateAsync({
      eventId: event?.id ?? null,
      docketMatterId: matterId,
      scheduledDate: values.scheduled_date,
      scheduledTime: values.scheduled_time || null,
      eventType: values.event_type || null,
      location: values.location || null,
      stageAtEvent: values.stage_at_event || null,
      outcomeAtEvent: values.outcome_at_event || null,
      ordersMadeAtEvent: values.orders_made_at_event || null,
      notes: values.notes || null,
      eventStatus: values.event_status,
      categoryId: values.category_id || null,
      acknowledgeOverride,
      overrideReason,
    });
    if (result.status === "capacity_reached") {
      setPendingOverride({ result, values });
      return;
    }
    setPendingOverride(null);
    onClose();
  }

  async function onSubmit(values: DocketEventFormValues) {
    try {
      await submit(values, false, null);
    } catch {
      // Surfaced globally via the mutation cache toast subscriber.
    }
  }

  async function onConfirmOverride(reason: string | null) {
    if (!pendingOverride) return;
    try {
      await submit(pendingOverride.values, true, reason);
    } catch {
      // Surfaced globally via the mutation cache toast subscriber.
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{event ? "Edit event" : "Add event"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="scheduled_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date</FormLabel>
                    <FormControl>
                      <DateOnlyInput
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        aria-label="Event date"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="scheduled_time"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Time (optional)</FormLabel>
                    <FormControl>
                      <Input type="time" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="event_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Event type</FormLabel>
                    <FormControl>
                      <ControlledVocabSelect
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        options={EVENT_TYPES}
                        placeholder="Select event type…"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="event_status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <FormControl>
                      <Select {...field}>
                        {DOCKET_EVENT_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {toTitleCase(s)}
                          </option>
                        ))}
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="category_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Matter category (optional)</FormLabel>
                  <FormControl>
                    <Select {...field}>
                      <option value="">No category — not capacity-checked</option>
                      {(categories ?? []).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                  </FormControl>
                  {activeSnapshot && (
                    <CapacityIndicator
                      categoryName="On this date"
                      scheduledCount={activeSnapshot.scheduled_count}
                      dailyCapacity={activeSnapshot.daily_capacity}
                      variant="bar"
                    />
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="location"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Location (optional)</FormLabel>
                  <FormControl>
                    <Input {...field} />
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
                  <FormLabel>Stage at event (optional)</FormLabel>
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

            <FormField
              control={form.control}
              name="outcome_at_event"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Outcome at event (optional)</FormLabel>
                  <FormControl>
                    <Textarea rows={2} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="orders_made_at_event"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Orders made (optional)</FormLabel>
                  <FormControl>
                    <Textarea rows={2} {...field} />
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
                  <FormLabel>Notes (optional)</FormLabel>
                  <FormControl>
                    <Textarea rows={2} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending && <LoadingSpinner className="text-current" size={16} />}
                {event ? "Save changes" : "Add event"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>

      {pendingOverride && (
        <CapacityOverrideDialog
          info={pendingOverride.result}
          scheduledDate={pendingOverride.values.scheduled_date}
          isPending={isPending}
          onCancel={() => setPendingOverride(null)}
          onConfirm={(reason) => void onConfirmOverride(reason)}
          onDateSuggested={(date) => form.setValue("scheduled_date", date)}
        />
      )}
    </Dialog>
  );
}
