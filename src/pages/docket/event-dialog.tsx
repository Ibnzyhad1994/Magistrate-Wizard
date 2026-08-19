import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
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
  useCreateDocketEvent,
  useUpdateDocketEvent,
} from "@/hooks/docket/use-docket-events";
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
  const createEvent = useCreateDocketEvent(matterId);
  const updateEvent = useUpdateDocketEvent(matterId);
  const isPending = createEvent.isPending || updateEvent.isPending;

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
    },
  });

  async function onSubmit(values: DocketEventFormValues) {
    const payload = {
      scheduled_date: values.scheduled_date,
      scheduled_time: values.scheduled_time || null,
      event_type: values.event_type || null,
      location: values.location || null,
      stage_at_event: values.stage_at_event || null,
      outcome_at_event: values.outcome_at_event || null,
      orders_made_at_event: values.orders_made_at_event || null,
      notes: values.notes || null,
      event_status: values.event_status,
    };
    try {
      if (event) {
        await updateEvent.mutateAsync({ id: event.id, values: payload });
      } else {
        await createEvent.mutateAsync(payload);
      }
      onClose();
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
    </Dialog>
  );
}
