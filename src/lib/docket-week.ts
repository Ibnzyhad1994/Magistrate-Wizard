import { getLocalDateOnly, parseDateOnly } from "@/lib/utils";

/**
 * Sunday that opens the week containing `isoDate` (YYYY-MM-DD).
 * Uses local calendar math so a date-only string never shifts in UTC-4.
 */
export function weekStartSunday(isoDate: string): string {
  const date = parseDateOnly(isoDate);
  date.setDate(date.getDate() - date.getDay());
  return getLocalDateOnly(date);
}

export function addDaysIso(isoDate: string, days: number): string {
  const date = parseDateOnly(isoDate);
  date.setDate(date.getDate() + days);
  return getLocalDateOnly(date);
}

/** Seven local ISO dates, Sunday through Saturday. */
export function daysOfWeek(weekStartIso: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addDaysIso(weekStartIso, index));
}

/** Header copy: "Week of 30 Aug 2026" from that Sunday. */
export function weekOfLabel(weekStartIso: string): string {
  const formatted = parseDateOnly(weekStartIso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `Week of ${formatted}`;
}

/** Header copy for daily view: "Wednesday 2 Sep 2026". */
export function dayOfLabel(isoDate: string): string {
  return parseDateOnly(isoDate).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
