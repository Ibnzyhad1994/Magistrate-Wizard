import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { CalendarClock, MapPin, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { InlineError } from "@/components/common/inline-error";
import { LoadingSpinner } from "@/components/common/loading-spinner";
import {
  useCreateDocketEvent,
  useDocketEvents,
  useUpdateDocketEvent,
} from "@/hooks/docket/use-docket-events";
import {
  DOCKET_EVENT_STATUSES,
  EVENT_STAGES,
  EVENT_TYPES,
  docketEventSchema,
  type DocketEventFormValues,
} from "@/lib/validations/docket";
import { formatDate, formatTimeOnly, toTitleCase } from "@/lib/utils";
import { ControlledVocabSelect } from "@/components/common/controlled-vocab-select";
import type { DocketEvent } from "@/types/database.types";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  scheduled: "default",
  completed: "secondary",
  cancelled: "outline",
  entered_in_error: "destructive",
};

interface EventsSectionProps {
  matterId: string;
}

export function EventsSection({ matterId }: EventsSectionProps) {
  const { data, isPending, isError, error, refetch } = useDocketEvents(matterId);
  const [dialogEvent, setDialogEvent] = useState<DocketEvent | "new" | null>(null);

  return (
    <div className="mt-4 space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setDialogEvent("new")}>
          <Plus className="h-4 w-4" />
          Add event
        </Button>
      </div>

      {isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : isError ? (
        <InlineError error={error} onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="No events yet"
          description="Court appearances and other scheduled events for this matter will appear here."
          action={
            <Button size="sm" onClick={() => setDialogEvent("new")}>
              <Plus className="h-4 w-4" />
              Add the first event
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {data.map((event) => (
            <Card
              key={event.id}
              className="cursor-pointer transition-colors hover:bg-muted/40"
              onClick={() => setDialogEvent(event)}
            >
              <CardContent className="flex flex-wrap items-start justify-between gap-2 p-4">
                <div className="min-w-0 space-y-1">
                  <p className="font-medium text-foreground">
                    {formatDate(event.scheduled_date)}
                    {event.scheduled_time ? ` at ${formatTimeOnly(event.scheduled_time)}` : ""}
                    {event.event_type ? ` — ${event.event_type}` : ""}
                  </p>
                  {event.stage_at_event && (
                    <p className="text-sm text-muted-foreground">
                      Stage: {event.stage_at_event}
                    </p>
                  )}
                  {event.location && (
                    <p className="flex items-center gap-1 text-sm text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5 shrink-0" />
                      {event.location}
                    </p>
                  )}
                  {event.outcome_at_event && (
                    <p className="text-sm text-muted-foreground">
                      Outcome: {event.outcome_at_event}
                    </p>
                  )}
                  {event.orders_made_at_event && (
                    <p className="text-sm text-muted-foreground">
                      Orders: {event.orders_made_at_event}
                    </p>
                  )}
                </div>
                <Badge variant={STATUS_VARIANT[event.event_status] ?? "outline"}>
                  {toTitleCase(event.event_status)}
                </Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {dialogEvent && (
        <EventDialog
          matterId={matterId}
          event={dialogEvent === "new" ? null : dialogEvent}
          onClose={() => setDialogEvent(null)}
        />
      )}
    </div>
  );
}

function EventDialog({
  matterId,
  event,
  onClose,
}: {
  matterId: string;
  event: DocketEvent | null;
  onClose: () => void;
}) {
  const createEvent = useCreateDocketEvent(matterId);
  const updateEvent = useUpdateDocketEvent(matterId);
  const isPending = createEvent.isPending || updateEvent.isPending;

  const form = useForm<DocketEventFormValues>({
    resolver: zodResolver(docketEventSchema),
    defaultValues: {
      scheduled_date: event?.scheduled_date ?? "",
      scheduled_time: event?.scheduled_time ?? "",
      event_type: event?.event_type ?? "",
      location: event?.location ?? "",
      stage_at_event: event?.stage_at_event ?? "",
      outcome_at_event: event?.outcome_at_event ?? "",
      orders_made_at_event: event?.orders_made_at_event ?? "",
      notes: event?.notes ?? "",
      event_status: (event?.event_status as DocketEventFormValues["event_status"]) ?? "scheduled",
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
                      <Input type="date" {...field} />
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
