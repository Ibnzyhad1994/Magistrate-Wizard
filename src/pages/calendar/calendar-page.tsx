import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { BrowseHeader, BrowsePage } from "@/components/browse";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/common/empty-state";
import { InlineError } from "@/components/common/inline-error";
import { Skeleton } from "@/components/ui/skeleton";
import { useCalendarEvents, type CalendarEventRow } from "@/hooks/docket/use-calendar-events";
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
  const [view, setView] = useState<"month" | "agenda">("month");

  const from = monthStart(cursor.year, cursor.month);
  const to = monthEnd(cursor.year, cursor.month);
  const { data, isPending, isError, error, refetch } = useCalendarEvents(from, to);
  const events = data ?? [];
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
        description="Hearings and appearances from Docket matters you can already see. Google sync lives in Settings."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={view === "month" ? "default" : "outline"}
              size="sm"
              onClick={() => setView("month")}
              aria-pressed={view === "month"}
            >
              Month
            </Button>
            <Button
              variant={view === "agenda" ? "default" : "outline"}
              size="sm"
              onClick={() => setView("agenda")}
              aria-pressed={view === "agenda"}
            >
              Agenda
            </Button>
            <Button variant="outline" size="sm" onClick={handleToday}>
              Today
            </Button>
            <Button variant="ghost" size="icon" onClick={handlePrev} aria-label="Previous month">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <p className="min-w-[9rem] text-center text-sm font-semibold text-white">{monthLabel}</p>
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
          icon={CalendarDays}
          title="No sittings this month"
          description="Appearances you can view on the Docket will show here."
        />
      ) : null}

      {view === "month" && !isPending && !isError ? (
        <div className="overflow-x-auto rounded-md border border-white/10 bg-[#181818]">
          <div className="grid min-w-[640px] grid-cols-7 border-b border-white/10">
            {WEEKDAYS.map((day) => (
              <div
                key={day}
                className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-white/50"
              >
                {day}
              </div>
            ))}
          </div>
          <div className="grid min-w-[640px] grid-cols-7">
            {cells.map((date) => {
              const inMonth = date.startsWith(from.slice(0, 7));
              const dayEvents = byDate.get(date) ?? [];
              const isToday = date === today;
              return (
                <div
                  key={date}
                  className={cn(
                    "min-h-[6.5rem] border-b border-r border-white/5 p-1.5",
                    !inMonth && "bg-black/20 text-white/35",
                  )}
                >
                  <div
                    className={cn(
                      "mb-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs",
                      isToday && "bg-primary font-semibold text-white",
                    )}
                  >
                    {Number(date.slice(8))}
                  </div>
                  <ul className="space-y-1">
                    {dayEvents.slice(0, 3).map((event) => (
                      <li key={event.id}>
                        <button
                          type="button"
                          onClick={() => handleOpenEvent(event)}
                          className={cn(
                            "block w-full truncate rounded px-1 py-0.5 text-left text-[11px] text-white/90 hover:bg-white/10",
                            isInactiveEventStatus(event.event_status) && "text-white/40 line-through",
                          )}
                          aria-label={`${event.case_number} ${event.matter_title}`}
                        >
                          {event.scheduled_time
                            ? `${formatTimeOnly(event.scheduled_time)} · `
                            : ""}
                          {event.case_number}
                        </button>
                      </li>
                    ))}
                    {dayEvents.length > 3 ? (
                      <li className="px-1 text-[10px] text-white/45">+{dayEvents.length - 3} more</li>
                    ) : null}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {view === "agenda" && !isPending && !isError && events.length > 0 ? (
        <ol className="divide-y divide-white/10 overflow-hidden rounded-md border border-white/10 bg-[#181818]">
          {events.map((event) => (
            <li key={event.id}>
              <button
                type="button"
                onClick={() => handleOpenEvent(event)}
                className={cn(
                  "flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-white/5 sm:flex-row sm:items-center sm:justify-between",
                  isInactiveEventStatus(event.event_status) && "opacity-45",
                )}
              >
                <div>
                  <p className="text-sm font-semibold text-white">
                    {event.case_number} — {event.matter_title}
                  </p>
                  <p className="text-xs text-white/60">
                    {toTitleCase(event.event_type || "Hearing")}
                    {event.location ? ` · ${event.location}` : ""}
                    {isInactiveEventStatus(event.event_status)
                      ? ` · ${toTitleCase(event.event_status)}`
                      : ""}
                  </p>
                </div>
                <p className="text-xs text-white/70">
                  {formatDate(event.scheduled_date)}
                  {event.scheduled_time ? ` · ${formatTimeOnly(event.scheduled_time)}` : " · All day"}
                </p>
              </button>
            </li>
          ))}
        </ol>
      ) : null}
    </BrowsePage>
  );
}
