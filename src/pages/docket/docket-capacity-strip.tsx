import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useDocketMatterCategories,
  useDocketCapacitySnapshot,
} from "@/hooks/docket/use-docket-capacity";
import { CapacityIndicator } from "@/pages/docket/capacity-indicator";
import { getCapacityStyle } from "@/lib/docket-capacity";
import { getLocalDateOnly } from "@/lib/utils";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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
}: {
  date: string;
  selected: boolean;
  today: boolean;
  onSelect: () => void;
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

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      title={
        worst
          ? `Busiest category this date: ${worst.scheduled_count} of ${worst.daily_capacity}`
          : "No capacity configured for this date"
      }
      className={`flex h-12 w-full flex-col items-center justify-center gap-0.5 rounded-sm border text-xs transition-colors sm:h-14 ${style.textClass} ${
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
    </button>
  );
}

/**
 * Always-visible monthly capacity calendar embedded directly in the
 * Docket page — not a dialog. Fills the same content width as the search
 * bar/table below it rather than being capped to a small left-aligned
 * block; only the tile HEIGHT stays compact (see DayTile). Selection is
 * controlled by the parent (DocketListPage) — this component doesn't own
 * "which date is selected" itself, because the whole point of this pass
 * is that the Docket table below must react to the same selection, not
 * just this calendar's own detail panel.
 */
export function DocketCapacityStrip({
  selectedDate,
  onSelectDate,
}: {
  selectedDate: string | null;
  onSelectDate: (date: string | null) => void;
}) {
  const today = getLocalDateOnly();
  const [todayYear, todayMonthNum] = today.split("-").map(Number);
  const [year, setYear] = useState(todayYear);
  const [month, setMonth] = useState(todayMonthNum - 1); // 0-indexed
  const { data: categories } = useDocketMatterCategories();
  const { data: snapshot } = useDocketCapacitySnapshot(selectedDate ?? undefined);

  const cells = useMemo(() => buildMonthGrid(year, month), [year, month]);

  function goToMonth(y: number, m: number) {
    // Normalize month overflow/underflow (m can be -1 or 12 from nav).
    const d = new Date(y, m, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
    onSelectDate(null);
  }

  function goToday() {
    setYear(todayYear);
    setMonth(todayMonthNum - 1);
    onSelectDate(today);
  }

  return (
    <div className="mb-4 space-y-3 rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-foreground">Docket capacity — {monthLabel(year, month)}</span>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" aria-label="Previous month" onClick={() => goToMonth(year, month - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="ghost" onClick={goToday}>
            Today
          </Button>
          <Button size="icon" variant="ghost" aria-label="Next month" onClick={() => goToMonth(year, month + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div>
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {WEEKDAY_LABELS.map((w) => (
            <span key={w}>
              <span className="hidden sm:inline">{w}</span>
              <span className="sm:hidden">{w[0]}</span>
            </span>
          ))}
        </div>

        <div className="mt-1 grid grid-cols-7 gap-1">
          {cells.map((cell, i) =>
            cell.inMonth ? (
              <DayTile
                key={cell.date}
                date={cell.date}
                selected={cell.date === selectedDate}
                today={cell.date === today}
                onSelect={() => onSelectDate(cell.date)}
              />
            ) : (
              <div key={`blank-${i}`} className="h-12 w-full sm:h-14" />
            ),
          )}
        </div>
      </div>

      <div className="space-y-1.5 border-t border-border pt-2">
        {selectedDate ? (
          <>
            <p className="text-xs text-muted-foreground">
              {new Date(`${selectedDate}T00:00:00`).toLocaleDateString(undefined, {
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
