import { Link } from "react-router-dom";
import { DashboardHeading } from "@/components/dashboard/dashboard-folio";
import { ROUTES } from "@/routes/paths";
import { formatDate, formatTimeOnly, toTitleCase } from "@/lib/utils";
import type { EventPulseRow } from "@/lib/dashboard-insights";
import { isOverdueScheduled } from "@/lib/dashboard-insights";

export function AppearanceTimeline({ events, today }: { events: EventPulseRow[]; today: string }) {
  const upcoming = events
    .filter(
      (event) => event.event_status !== "cancelled" && event.event_status !== "entered_in_error",
    )
    .filter((event) => event.scheduled_date >= today)
    .slice(0, 12);
  const overdue = events.filter((event) => isOverdueScheduled(event, today)).slice(0, 8);

  return (
    <section aria-labelledby="timeline-heading">
      <DashboardHeading
        id="timeline-heading"
        hintLabel="What this timeline shows"
        hint="Overdue means still marked scheduled after the sitting date. Upcoming is the next fourteen days the caller can already see. Completing the appearance writes the paper trail."
      >
        Appearances
      </DashboardHeading>
      {overdue.length > 0 && (
        <ol className="mb-6 space-y-3 border-l-2 border-destructive pl-4">
          {overdue.map((event) => (
            <li key={event.id}>
              <Link
                to={ROUTES.docketMatterEvents(event.docket_matter_id)}
                className="block outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <p className="eyebrow text-destructive">
                  Overdue · {formatDate(event.scheduled_date)}
                </p>
                <p className="mt-1 text-sm text-foreground">
                  {event.case_number} · {event.matter_title}
                </p>
              </Link>
            </li>
          ))}
        </ol>
      )}
      {upcoming.length === 0 ? (
        <p className="text-sm leading-relaxed text-muted-foreground">
          No upcoming appearances in the next two weeks.
        </p>
      ) : (
        <ol className="relative space-y-0 before:absolute before:bottom-2 before:left-[4.35rem] before:top-2 before:w-px before:bg-foreground/15 sm:before:left-[5.1rem]">
          {upcoming.map((event) => (
            <li
              key={event.id}
              className="grid grid-cols-[4.25rem_1fr] gap-4 border-b border-hairline py-3 last:border-0 sm:grid-cols-[5rem_1fr]"
            >
              <div className="text-right">
                <p className="text-sm font-semibold tabular-nums leading-tight text-foreground">
                  {formatDate(event.scheduled_date, { day: "numeric", month: "short" })}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {event.scheduled_time ? formatTimeOnly(event.scheduled_time) : "Time unset"}
                </p>
              </div>
              <Link
                to={ROUTES.docketMatterEvents(event.docket_matter_id)}
                className="min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <p className="truncate text-sm font-medium text-foreground">
                  {event.case_number} · {event.matter_title}
                </p>
                <p className="eyebrow mt-1 text-muted-foreground">
                  {toTitleCase((event.event_type ?? "appearance").replace(/_/g, " "))}
                  {event.outcome_at_event ? ` · ${event.outcome_at_event}` : ""}
                </p>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
