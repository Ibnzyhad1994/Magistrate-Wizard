import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useDocketMatterCategories,
  useDocketCapacitySnapshot,
} from "@/hooks/docket/use-docket-capacity";
import { CapacityIndicator } from "@/pages/docket/capacity-indicator";
import { HintTooltip } from "@/components/ui/tooltip";
import { capacityStatusLabel, getCapacityStyle } from "@/lib/docket-capacity";
import { daysOfWeek, weekOfLabel, weekStartSunday, addDaysIso, dayOfLabel } from "@/lib/docket-week";
import { formatDate, getLocalDateOnly, parseDateOnly } from "@/lib/utils";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const CAPACITY_VIEWS = [
  { id: "week", label: "Weekly" },
  { id: "day", label: "Daily" },
  { id: "month", label: "Monthly" },
] as const;

type CapacityView = (typeof CAPACITY_VIEWS)[number]["id"];

function WeekdayRow() {
  return (
    <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {WEEKDAY_LABELS.map((w) => (
        <span key={w}>
          <span className="hidden sm:inline">{w}</span>
          <span className="sm:hidden">{w[0]}</span>
        </span>
      ))}
    </div>
  );
}

function toDateStr(y: number, m: number, d: number): string {
  const dt = new Date(y, m, d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function monthLabel(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

/** Every cell in the 6x7 grid, including leading/trailing days from adjacent months (rendered as blank, non-interactive placeholders — no capacity is fetched for them). */
function buildMonthGrid(year: number, month: number): { date: string; inMonth: boolean }[] {
  const firstOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingBlanks = firstOfMonth.getDay(); // 0 = Sunday
  const totalCells = Math.ceil((leadingBlanks + daysInMonth) / 7) * 7;

  const cells: { date: string; inMonth: boolean }[] = [];
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - leadingBlanks + 1;
    if (dayNum < 1 || dayNum > daysInMonth) {
      cells.push({ date: "", inMonth: false });
    } else {
      cells.push({ date: toDateStr(year, month, dayNum), inMonth: true });
    }
  }
  return cells;
}

/**
 * One day tile in the month grid. Deliberately NOT square — a fixed,
 * compact height with the grid's natural full-width column as its width,
 * so the tile is a wide rectangle: efficient screen use for a workload
 * calendar matters more than conventional square calendar styling. The
 * entire tile background still carries the traffic-light colour — not a
 * border, not just the date number. "Selected" and "today" are shown as a
 * ring and a border respectively, both of which compose independently of
 * the inline background-color fill so they stay visible at every band,
 * including a solid red Full/Over-capacity tile.
 */
function DayTile({
  date,
  selected,
  today,
  onSelect,
  size = "compact",
}: {
  date: string;
  selected: boolean;
  today: boolean;
  onSelect: () => void;
  size?: "compact" | "day";
}) {
  const { data: snapshot } = useDocketCapacitySnapshot(date);
  const day = Number(date.slice(-2));

  const worst = useMemo(() => {
    const configured = (snapshot ?? []).filter((s) => s.daily_capacity != null);
    if (configured.length === 0) return null;
    return configured.reduce((worstRow, row) =>
      row.scheduled_count / (row.daily_capacity as number) >
      worstRow.scheduled_count / (worstRow.daily_capacity as number)
        ? row
        : worstRow,
    );
  }, [snapshot]);

  const style = worst
    ? getCapacityStyle(worst.scheduled_count, worst.daily_capacity)
    : getCapacityStyle(0, null);
  const hint = worst
    ? `${capacityStatusLabel(style.band)}. Busiest: ${worst.scheduled_count} of ${worst.daily_capacity}`
    : "No capacity configured for this date";

  return (
    <HintTooltip label={hint}>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={`${date}. ${hint}`}
        className={`flex w-full flex-col items-center justify-center gap-0.5 rounded-sm border text-xs transition-colors ${
          size === "day" ? "h-20 sm:h-24" : "h-12 sm:h-14"
        } ${style.textClass} ${
          today ? "border-2 border-blue-500" : "border-black/10"
        } ${selected ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : ""}`}
        style={{ backgroundColor: style.bg }}
      >
        <span className="text-sm font-bold leading-none">{day}</span>
        {worst && (
          <span className="flex items-center gap-0.5 text-[10px] font-semibold leading-none">
            {style.band === "over_capacity" && <AlertTriangle className="h-2.5 w-2.5" />}
            {worst.scheduled_count}/{worst.daily_capacity}
          </span>
        )}
        {size === "day" && (
          <span className="text-[10px] font-medium leading-none">
            {parseDateOnly(date).toLocaleDateString("en-GB", { weekday: "short" })}
          </span>
        )}
      </button>
    </HintTooltip>
  );
}

/**
 * Capacity chrome on Docket. Weekly, daily, or monthly tiles, switched
 * from a persistent toggle — not a one-shot Month disclosure.
 */
export function DocketCapacityStrip({
  selectedDate,
  onSelectDate,
  onEditLimits,
}: {
  selectedDate: string | null;
  onSelectDate: (date: string | null) => void;
  onEditLimits?: () => void;
}) {
  const today = getLocalDateOnly();
  const [todayYear, todayMonthNum] = today.split("-").map(Number);
  const [year, setYear] = useState(todayYear);
  const [month, setMonth] = useState(todayMonthNum - 1);
  const [calendarView, setCalendarView] = useState<CapacityView>("week");
  const [weekAnchor, setWeekAnchor] = useState(today);
  const { data: categories } = useDocketMatterCategories();
  const { data: snapshot } = useDocketCapacitySnapshot(selectedDate ?? undefined);

  useEffect(() => {
    if (!selectedDate) return;
    setWeekAnchor(selectedDate);
    const parsed = parseDateOnly(selectedDate);
    setYear(parsed.getFullYear());
    setMonth(parsed.getMonth());
  }, [selectedDate]);

  const focusDate = selectedDate ?? weekAnchor;
  const weekStart = weekStartSunday(focusDate);
  const weekDays = daysOfWeek(weekStart);
  const cells = useMemo(() => buildMonthGrid(year, month), [year, month]);

  const handleSelectDay = (date: string) => {
    const next = date === selectedDate ? null : date;
    onSelectDate(next);
    if (next) {
      setWeekAnchor(next);
      const parsed = parseDateOnly(next);
      setYear(parsed.getFullYear());
      setMonth(parsed.getMonth());
    }
  };

  const handleGoToday = () => {
    setWeekAnchor(today);
    setYear(todayYear);
    setMonth(todayMonthNum - 1);
    onSelectDate(today);
  };

  const handleShiftWeek = (weeks: number) => {
    const nextStart = addDaysIso(weekStart, weeks * 7);
    setWeekAnchor(nextStart);
    const parsed = parseDateOnly(nextStart);
    setYear(parsed.getFullYear());
    setMonth(parsed.getMonth());
    onSelectDate(null);
  };

  const handleShiftDay = (days: number) => {
    const next = addDaysIso(focusDate, days);
    setWeekAnchor(next);
    const parsed = parseDateOnly(next);
    setYear(parsed.getFullYear());
    setMonth(parsed.getMonth());
    if (selectedDate) onSelectDate(next);
  };

  const handleGoMonth = (y: number, m: number) => {
    const d = new Date(y, m, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
    setWeekAnchor(getLocalDateOnly(d));
    onSelectDate(null);
  };

  const handleViewChange = (next: CapacityView) => {
    setCalendarView(next);
  };

  const handlePrev = () => {
    if (calendarView === "month") handleGoMonth(year, month - 1);
    else if (calendarView === "day") handleShiftDay(-1);
    else handleShiftWeek(-1);
  };

  const handleNext = () => {
    if (calendarView === "month") handleGoMonth(year, month + 1);
    else if (calendarView === "day") handleShiftDay(1);
    else handleShiftWeek(1);
  };

  const navUnit = calendarView === "month" ? "month" : calendarView === "day" ? "day" : "week";
  const heading =
    calendarView === "month"
      ? monthLabel(year, month)
      : calendarView === "day"
        ? dayOfLabel(focusDate)
        : weekOfLabel(weekStart);

  return (
    <div className="mb-4 space-y-3 rounded-md border border-border p-3">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 text-sm font-medium text-foreground">{heading}</span>
          <div className="flex shrink-0 items-center gap-0.5">
            <HintTooltip label={`Previous ${navUnit}`}>
              <Button
                size="icon"
                variant="ghost"
                className="min-h-11 min-w-11"
                aria-label={`Previous ${navUnit}`}
                onClick={handlePrev}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            </HintTooltip>
            <Button size="sm" variant="ghost" className="min-h-11 px-3" onClick={handleGoToday}>
              Today
            </Button>
            <HintTooltip label={`Next ${navUnit}`}>
              <Button
                size="icon"
                variant="ghost"
                className="min-h-11 min-w-11"
                aria-label={`Next ${navUnit}`}
                onClick={handleNext}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </HintTooltip>
          </div>
        </div>
        <div
          role="radiogroup"
          aria-label="Capacity calendar view"
          className="grid w-full grid-cols-3 rounded-md border border-white/15 p-0.5"
        >
          {CAPACITY_VIEWS.map((view) => {
            const selected = calendarView === view.id;
            const handleSelectView = () => handleViewChange(view.id);
            return (
              <Button
                key={view.id}
                size="sm"
                type="button"
                role="radio"
                aria-checked={selected}
                aria-pressed={selected}
                variant={selected ? "secondary" : "ghost"}
                className="min-h-11 w-full px-1 text-xs sm:text-sm"
                onClick={handleSelectView}
              >
                {view.label}
              </Button>
            );
          })}
        </div>
      </div>

      {calendarView === "week" && (
        <div>
          <WeekdayRow />
          <div className="mt-1 grid grid-cols-7 gap-1">
            {weekDays.map((date) => (
              <DayTile
                key={date}
                date={date}
                selected={date === selectedDate}
                today={date === today}
                onSelect={() => handleSelectDay(date)}
              />
            ))}
          </div>
        </div>
      )}

      {calendarView === "day" && (
        <div role="region" aria-label="Day capacity calendar" className="w-full max-w-[12rem]">
          <DayTile
            date={focusDate}
            selected={focusDate === selectedDate}
            today={focusDate === today}
            size="day"
            onSelect={() => handleSelectDay(focusDate)}
          />
        </div>
      )}

      {calendarView === "month" && (
        <div role="region" aria-label="Month capacity calendar">
          <WeekdayRow />
          <div className="mt-1 grid grid-cols-7 gap-1">
            {cells.map((cell, i) =>
              cell.inMonth ? (
                <DayTile
                  key={cell.date}
                  date={cell.date}
                  selected={cell.date === selectedDate}
                  today={cell.date === today}
                  onSelect={() => handleSelectDay(cell.date)}
                />
              ) : (
                <div key={`blank-${i}`} className="h-12 w-full sm:h-14" />
              ),
            )}
          </div>
        </div>
      )}

      <div className="space-y-1.5 border-t border-border pt-2">
        {selectedDate ? (
          <>
            <p className="text-xs text-muted-foreground">
              {formatDate(selectedDate, {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </p>
            <div className="flex flex-wrap gap-2">
              {(categories ?? []).map((cat) => {
                const row = (snapshot ?? []).find((s) => s.category_id === cat.id);
                return (
                  <CapacityIndicator
                    key={cat.id}
                    categoryName={cat.name}
                    scheduledCount={row?.scheduled_count ?? 0}
                    dailyCapacity={row?.daily_capacity ?? null}
                    variant="chip"
                    onPress={onEditLimits}
                  />
                );
              })}
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">Showing all matters. Select a date to filter the Docket below.</p>
        )}
      </div>
    </div>
  );
}
