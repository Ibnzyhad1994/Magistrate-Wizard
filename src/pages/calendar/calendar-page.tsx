import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { BrowseHeader, BrowsePage } from "@/components/browse";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/empty-state";
import { InlineError } from "@/components/common/inline-error";
import { Skeleton } from "@/components/ui/skeleton";
import { useCalendarEvents, type CalendarEventRow } from "@/hooks/docket/use-calendar-events";
import { BREAKPOINTS } from "@/hooks/use-media-query";
import { ROUTES } from "@/routes/paths";
import {
  cn,
  formatDate,
  formatTimeOnly,
  getLocalDateOnly,
  parseDateOnly,
  toTitleCase,
} from "@/lib/utils";
import { isInactiveEventStatus } from "@/lib/google-calendar/map-event";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const monthStart = (year: number, month: number) =>
  `${year}-${String(month + 1).padStart(2, "0")}-01`;

const monthEnd = (year: number, month: number) => {
  const last = new Date(year, month + 1, 0);
  return getLocalDateOnly(last);
};

const monthCells = (year: number, month: number) => {
  const first = new Date(year, month, 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - mondayOffset);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    return getLocalDateOnly(d);
  });
};

const groupByDate = (events: CalendarEventRow[]) => {
  const map = new Map<string, CalendarEventRow[]>();
  for (const event of events) {
    const list = map.get(event.scheduled_date) ?? [];
    list.push(event);
    map.set(event.scheduled_date, list);
  }
  return map;
};

export default function CalendarPage() {
  const navigate = useNavigate();
  const today = getLocalDateOnly();
  const initial = parseDateOnly(today);
  const [cursor, setCursor] = useState(() => ({
    year: initial.getFullYear(),
    month: initial.getMonth(),
  }));
  const [view, setView] = useState<"month" | "agenda">(() =>
    typeof window !== "undefined" && window.matchMedia(BREAKPOINTS.md).matches ? "month" : "agenda",
  );

  const from = monthStart(cursor.year, cursor.month);
  const to = monthEnd(cursor.year, cursor.month);
  const { data, isPending, isFetching, isError, error, refetch } = useCalendarEvents(from, to);
  const events = useMemo(() => data ?? [], [data]);
  const byDate = useMemo(() => groupByDate(events), [events]);
  const cells = useMemo(() => monthCells(cursor.year, cursor.month), [cursor]);
  const monthLabel = new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
  }).format(new Date(cursor.year, cursor.month, 1));

  const handlePrev = () => {
    setCursor((c) =>
      c.month === 0 ? { year: c.year - 1, month: 11 } : { year: c.year, month: c.month - 1 },
    );
  };
  const handleNext = () => {
    setCursor((c) =>
      c.month === 11 ? { year: c.year + 1, month: 0 } : { year: c.year, month: c.month + 1 },
    );
  };
  const handleToday = () => {
    const now = parseDateOnly(getLocalDateOnly());
    setCursor({ year: now.getFullYear(), month: now.getMonth() });
  };
  const handleOpenEvent = (event: CalendarEventRow) => {
    navigate(ROUTES.docketMatterEvents(event.docket_matter_id));
  };

  return (
    <BrowsePage>
      <BrowseHeader
        title="Calendar"
        tone="docket"
        description="Hearings and appearances from Docket matters you can already see. Google sync lives in Settings."
        dataTour="page-calendar"
        action={
          <div className="flex flex-wrap items-center gap-2">
            {/* A view switch, not a commit action, so it is a segmented
                control rather than a red button. */}
            <div
              role="group"
              aria-label="Calendar view"
              className="inline-grid grid-cols-2 rounded-md bg-surface-2 p-0.5 hc:border hc:border-border"
            >
              {(["month", "agenda"] as const).map((option) => (
                <Button
                  key={option}
                  variant="ghost"
                  size="sm"
                  onClick={() => setView(option)}
                  aria-pressed={view === option}
                  className={cn(
                    "min-h-9 px-4",
                    view === option &&
                      "bg-surface-1 text-foreground shadow-elevation-1 hover:bg-surface-1 hc:bg-foreground hc:text-background",
                  )}
                >
                  {option === "month" ? "Month" : "Agenda"}
                </Button>
              ))}
            </div>
            <Button variant="secondary" size="sm" onClick={handleToday}>
              Today
            </Button>
            <Button variant="ghost" size="icon" onClick={handlePrev} aria-label="Previous month">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <p className="min-w-[9rem] text-center text-sm font-semibold text-foreground">
              {monthLabel}
            </p>
            <Button variant="ghost" size="icon" onClick={handleNext} aria-label="Next month">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        }
      />

      {isError ? <InlineError error={error} onRetry={() => void refetch()} /> : null}

      {isPending ? (
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: 14 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : null}

      {!isPending && !isError && events.length === 0 && view === "agenda" ? (
        <EmptyState
          tone="docket"
          icon={CalendarDays}
          title="No sittings this month"
          description="Appearances you can view on the Docket will show here."
        />
      ) : null}

      {view === "month" && !isPending && !isError ? (
        <div
          className={cn(
            "overflow-x-auto rounded-md border border-hairline bg-card shadow-elevation-1 transition-opacity duration-150 hc:border-border",
            // Month navigation now holds the previous month's grid while
            // the next loads (placeholderData) instead of blanking to
            // skeletons — dimming keeps that legible as "refreshing"
            // rather than looking like stale data.
            isFetching && "opacity-60",
          )}
          aria-busy={isFetching}
        >
          <div className="grid grid-cols-7 border-b border-hairline hc:border-border">
            {WEEKDAYS.map((day) => (
              <div
                key={day}
                className="eyebrow px-0.5 py-2.5 text-center text-[10px] text-muted-foreground sm:px-2"
              >
                {day}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((date) => {
              const inMonth = date.startsWith(from.slice(0, 7));
              const dayEvents = byDate.get(date) ?? [];
              const isToday = date === today;
              return (
                <div
                  key={date}
                  className={cn(
                    "min-h-[3.25rem] border-b border-r border-hairline p-1 transition-colors hover:bg-surface-2 sm:min-h-[6.5rem] sm:p-1.5",
                    !inMonth && "bg-background text-muted-foreground",
                  )}
                >
                  <div
                    className={cn(
                      "mb-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium",
                      isToday && "bg-primary font-bold text-primary-foreground",
                    )}
                  >
                    {Number(date.slice(8))}
                  </div>
                  <div
                    className="flex flex-wrap gap-0.5 sm:hidden"
                    aria-hidden={dayEvents.length === 0}
                  >
                    {dayEvents.slice(0, 3).map((event) => (
                      <span
                        key={event.id}
                        className={cn(
                          "h-1.5 w-1.5 rounded-full bg-primary",
                          event.pending && "bg-notice-action",
                          isInactiveEventStatus(event.event_status) && "bg-foreground/30",
                        )}
                      />
                    ))}
                  </div>
                  <ul className="hidden space-y-1 sm:block">
                    {dayEvents.slice(0, 3).map((event) => (
                      <li key={event.id}>
                        <button
                          type="button"
                          onClick={() => handleOpenEvent(event)}
                          className={cn(
                            // A chip with a coloured leading edge, the way an
                            // event reads in a streaming guide: colour says what
                            // kind of thing it is, the surface says it is one item.
                            "block w-full truncate rounded-sm border-l-2 border-primary bg-primary/10 px-1.5 py-0.5 text-left text-[11px] font-medium text-foreground transition-colors hover:bg-primary/20",
                            isInactiveEventStatus(event.event_status) &&
                              "border-muted-foreground/40 bg-muted text-muted-foreground line-through",
                            event.pending &&
                              "border-notice-action bg-notice-action/10 text-notice-action",
                          )}
                          title={event.court_name ?? undefined}
                          aria-label={`${event.case_number} ${event.matter_title}${event.court_name ? ` · ${event.court_name}` : ""}${event.pending ? " (on this device)" : ""}`}
                        >
                          {event.scheduled_time ? `${formatTimeOnly(event.scheduled_time)} · ` : ""}
                          {event.case_number}
                        </button>
                      </li>
                    ))}
                    {dayEvents.length > 3 ? (
                      <li className="px-1 text-[10px] text-muted-foreground">
                        +{dayEvents.length - 3} more
                      </li>
                    ) : null}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {view === "agenda" && !isPending && !isError && events.length > 0 ? (
        <ol
          className={cn(
            "divide-y divide-hairline overflow-hidden rounded-md border border-hairline bg-card shadow-elevation-1 transition-opacity duration-150 hc:border-border",
            isFetching && "opacity-60",
          )}
          aria-busy={isFetching}
        >
          {events.map((event) => (
            <li key={event.id}>
              <button
                type="button"
                onClick={() => handleOpenEvent(event)}
                className={cn(
                  "flex w-full flex-col gap-1 border-l-2 border-primary px-4 py-3 text-left transition-colors hover:bg-surface-2 sm:flex-row sm:items-center sm:justify-between",
                  isInactiveEventStatus(event.event_status) && "opacity-45",
                  event.pending && "text-notice-action",
                )}
              >
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {event.case_number} · {event.matter_title}
                  </p>
                  {event.court_name && (
                    <span className="mt-0.5 inline-block truncate rounded-[2px] border border-foreground/20 bg-foreground/10 px-1.5 py-0.5 text-[10px] font-medium text-foreground/80">
                      {event.court_name}
                    </span>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {toTitleCase(event.event_type || "Hearing")}
                    {event.location ? ` · ${event.location}` : ""}
                    {event.pending ? " · On this device" : ""}
                    {isInactiveEventStatus(event.event_status)
                      ? ` · ${toTitleCase(event.event_status)}`
                      : ""}
                  </p>
                </div>
                <p className="text-xs text-foreground/70">
                  {formatDate(event.scheduled_date)}
                  {event.scheduled_time
                    ? ` · ${formatTimeOnly(event.scheduled_time)}`
                    : " · All day"}
                </p>
              </button>
            </li>
          ))}
        </ol>
      ) : null}
    </BrowsePage>
  );
}
