import { useState } from "react";
import { CalendarClock, MapPin, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { InlineError } from "@/components/common/inline-error";
import { useDocketEvents } from "@/hooks/docket/use-docket-events";
import { usePendingHearings } from "@/hooks/offline/use-pending-hearings";
import { formatDate, formatTimeOnly, toTitleCase } from "@/lib/utils";
import { useDocketMatterAccess } from "@/hooks/docket/use-docket-matter-access";
import { DocketEventDialog } from "@/pages/docket/event-dialog";
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
  const { data: access } = useDocketMatterAccess(matterId);
  const { eventIds: pendingIds } = usePendingHearings();
  const canEdit = access?.canEdit ?? false;
  const [dialogEvent, setDialogEvent] = useState<DocketEvent | "new" | null>(null);

  return (
    <div className="mt-4 space-y-4">
      {canEdit && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setDialogEvent("new")}>
            <Plus className="h-4 w-4" />
            Add event
          </Button>
        </div>
      )}

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
            canEdit ? (
              <Button size="sm" onClick={() => setDialogEvent("new")}>
                <Plus className="h-4 w-4" />
                Add the first event
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          {data.map((event) => {
            const pending = pendingIds.has(event.id);
            return (
            <Card
              key={event.id}
              className={
                canEdit
                  ? "cursor-pointer transition-colors hover:bg-muted/40"
                  : undefined
              }
              onClick={canEdit ? () => setDialogEvent(event) : undefined}
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
                <div className="flex flex-wrap items-center gap-1.5">
                  {pending ? (
                    <Badge variant="outline">On this device</Badge>
                  ) : null}
                  <Badge variant={STATUS_VARIANT[event.event_status] ?? "outline"}>
                    {toTitleCase(event.event_status)}
                  </Badge>
                </div>
              </CardContent>
            </Card>
            );
          })}
        </div>
      )}

      {dialogEvent && (
        <DocketEventDialog
          matterId={matterId}
          event={dialogEvent === "new" ? null : dialogEvent}
          onClose={() => setDialogEvent(null)}
        />
      )}
    </div>
  );
}
