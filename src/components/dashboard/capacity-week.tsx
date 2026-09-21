import { Link } from "react-router-dom";
import { getCapacityStyle } from "@/lib/docket-capacity";
import { useDocketCapacitySnapshot } from "@/hooks/docket/use-docket-capacity";
import { HintTooltip } from "@/components/ui/tooltip";
import { DashboardHeading } from "@/components/dashboard/dashboard-folio";
import { ROUTES } from "@/routes/paths";
import { cn, parseDateOnly } from "@/lib/utils";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function DayCell({ date, today }: { date: string; today: string }) {
  const { data: snapshot, isPending } = useDocketCapacitySnapshot(date);
  const configured = (snapshot ?? []).filter((row) => row.daily_capacity != null);
  const worst = configured.reduce<(typeof configured)[number] | null>((acc, row) => {
    if (!acc) return row;
    const nextRatio = row.scheduled_count / (row.daily_capacity as number);
    const accRatio = acc.scheduled_count / (acc.daily_capacity as number);
    return nextRatio > accRatio ? row : acc;
  }, null);
  const style = worst
    ? getCapacityStyle(worst.scheduled_count, worst.daily_capacity)
    : getCapacityStyle(0, null);
  const total = Number(snapshot?.[0]?.total_matters_count ?? 0);
  const weekday = WEEKDAYS[parseDateOnly(date).getDay()];
  const dayNum = Number(date.slice(-2));
  const isToday = date === today;
  const hint = worst
    ? `${total} listed. ${worst.category_name} ${worst.scheduled_count} of ${worst.daily_capacity}.`
    : `${total} listed. Capacity not set.`;

  return (
    <HintTooltip label={hint}>
      <Link
        to={`${ROUTES.docket}?date=${date}&view=list`}
        aria-label={`${weekday} ${date}. ${hint}`}
        className={cn(
          "flex min-h-[5.75rem] flex-col items-center justify-center gap-1 bg-card px-1 py-3 text-center outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring",
          isToday && "ring-1 ring-inset ring-foreground/40",
        )}
        // Only paint a band colour; an unset day keeps the card surface
        // rather than an inline "transparent" that would show the grid
        // hairlines through it.
        style={{
          backgroundColor: isPending || style.band === "not_set" ? undefined : style.bg,
        }}
      >
        <span className={`eyebrow ${style.textClass}`}>{weekday}</span>
        <span className={`text-2xl font-bold leading-none tracking-tight ${style.textClass}`}>
          {dayNum}
        </span>
        <span className={`text-[10px] tabular-nums tracking-wide ${style.textClass}`}>
          {isPending ? "…" : total}
        </span>
      </Link>
    </HintTooltip>
  );
}

export function CapacityWeek({ dates, today }: { dates: string[]; today: string }) {
  return (
    <section aria-labelledby="capacity-week-heading">
      <DashboardHeading
        id="capacity-week-heading"
        hintLabel="How sitting load is counted"
        hint="The number is every matter that day. The colour shows your busiest type against your own limit."
      >
        Sitting load
      </DashboardHeading>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border border-hairline bg-hairline shadow-elevation-1 hc:border-border">
        {dates.map((date) => (
          <DayCell key={date} date={date} today={today} />
        ))}
      </div>
    </section>
  );
}
