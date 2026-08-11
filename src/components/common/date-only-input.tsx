import { useEffect, useRef, useState } from "react";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn, maskDDMMYYYY, parseDateOnly, parseDDMMYYYYToISO, toDDMMYYYY } from "@/lib/utils";

interface DateOnlyInputProps {
  /** The underlying `date`-column value as "YYYY-MM-DD", or "". */
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  className?: string;
}

const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/**
 * Calendar-date-only control — replaces native `<input type="date">`
 * wherever a `date` column (never a timestamp) is entered.
 *
 * Native `<input type="date">` renders its displayed text in whatever
 * format the BROWSER'S OWN locale setting dictates (`navigator.language`
 * / OS regional settings) — this is not something app code, CSS, or an
 * HTML attribute can override. A magistrate on a browser/OS configured
 * for `en-US` would see MM/DD/YYYY regardless of anything built into
 * BenchBook, silently reintroducing the exact day/month confusion this
 * whole date-handling pass exists to eliminate. So this is a fully
 * custom, controlled DD/MM/YYYY text field (typed-digit masking +
 * strict calendar validation, see `maskDDMMYYYY`/`parseDDMMYYYYToISO`
 * in `src/lib/utils.ts`) plus a small self-built calendar grid — never
 * a browser-locale-dependent native picker.
 *
 * Contract: always emits/accepts a plain "YYYY-MM-DD" string, exactly
 * like the native date input it replaces, so every existing
 * react-hook-form `field.value`/`field.onChange` call site is a drop-in
 * swap. The calendar grid is built entirely from LOCAL `Date`
 * construction (`new Date(year, month, day)`, `.getDay()`/`.getDate()`
 * on locally-constructed dates only) — never `new Date(dateString)` on a
 * "YYYY-MM-DD" value — so no UTC-parsing shift is possible here either.
 */
export function DateOnlyInput({
  value,
  onChange,
  onBlur,
  disabled,
  id,
  className,
  ...aria
}: DateOnlyInputProps) {
  const [text, setText] = useState(() => toDDMMYYYY(value));
  const [open, setOpen] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Re-sync displayed text when the underlying value changes from
  // OUTSIDE this component (e.g. a calendar day click below, a dialog
  // switching from "new" to editing an existing record, or a form
  // reset) — but never while the parsed text already matches, so this
  // doesn't fight the user's own in-progress typing.
  useEffect(() => {
    if (parseDDMMYYYYToISO(text) !== (value || null)) {
      setText(toDDMMYYYY(value));
      setInvalid(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const selected = value ? parseDateOnly(value) : null;
  const [viewDate, setViewDate] = useState(() => selected ?? new Date());
  useEffect(() => {
    if (open) setViewDate(selected ?? new Date());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleTextChange(raw: string) {
    const masked = maskDDMMYYYY(raw);
    setText(masked);
    if (masked === "") {
      setInvalid(false);
      onChange("");
      return;
    }
    if (masked.length === 10) {
      const iso = parseDDMMYYYYToISO(masked);
      if (iso) {
        setInvalid(false);
        onChange(iso);
      } else {
        setInvalid(true);
      }
    } else {
      setInvalid(false);
    }
  }

  function handleBlur() {
    if (text && text.length < 10) setInvalid(true);
    onBlur?.();
  }

  function pickDay(day: number) {
    const y = viewDate.getFullYear();
    const m = viewDate.getMonth();
    const iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    setText(toDDMMYYYY(iso));
    setInvalid(false);
    onChange(iso);
    setOpen(false);
  }

  const gridYear = viewDate.getFullYear();
  const gridMonth = viewDate.getMonth();
  const firstWeekday = new Date(gridYear, gridMonth, 1).getDay();
  const daysInMonth = new Date(gridYear, gridMonth + 1, 0).getDate();
  const monthLabel = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(
    new Date(gridYear, gridMonth, 1),
  );

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Input
          id={id}
          value={text}
          onChange={(e) => handleTextChange(e.target.value)}
          onBlur={handleBlur}
          onFocus={() => setOpen(true)}
          disabled={disabled}
          placeholder="DD/MM/YYYY"
          inputMode="numeric"
          autoComplete="off"
          className={cn("pr-9", invalid && "border-destructive", className)}
          aria-label={aria["aria-label"] ?? "Date (DD/MM/YYYY)"}
          aria-invalid={invalid}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          aria-label="Open calendar"
        >
          <CalendarIcon className="h-4 w-4" />
        </button>
      </div>
      {invalid && (
        <p className="mt-1 text-xs text-destructive">Enter a valid date as DD/MM/YYYY.</p>
      )}

      {open && !disabled && (
        <div className="absolute z-50 mt-1 w-64 rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-md">
          <div className="mb-2 flex items-center justify-between">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setViewDate(new Date(gridYear, gridMonth - 1, 1))}
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium">{monthLabel}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setViewDate(new Date(gridYear, gridMonth + 1, 1))}
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
            {WEEKDAY_LABELS.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {Array.from({ length: firstWeekday }).map((_, i) => (
              <span key={`blank-${i}`} />
            ))}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const isSelected =
                !!selected &&
                selected.getFullYear() === gridYear &&
                selected.getMonth() === gridMonth &&
                selected.getDate() === day;
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => pickDay(day)}
                  className={cn(
                    "h-7 w-7 rounded-md text-sm hover:bg-accent hover:text-accent-foreground",
                    isSelected && "bg-primary text-primary-foreground hover:bg-primary/90",
                  )}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
