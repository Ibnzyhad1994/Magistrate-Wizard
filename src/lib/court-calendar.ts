import { parseDateOnly } from "@/lib/utils";

/**
 * Whether a court sits on a given day.
 *
 * Mirrors `public.is_court_sitting_day()` (0159). Two implementations of
 * one rule is exactly where drift happens, so a live-db test asserts both
 * agree on one shared fixture set.
 *
 * Advisory throughout: a magistrate may lawfully sit on a holiday, so
 * nothing here blocks a save. It exists to stop a matter being adjourned
 * to Christmas Day by accident.
 */

export type NonSittingKind = "public_holiday" | "court_closure" | "sitting_exception";

export type NonSittingDay = {
  holiday_date: string;
  name: string;
  kind: NonSittingKind;
  court_id: string | null;
  district_id: string | null;
};

/** The court a date is being checked against. */
export type CourtScope = {
  courtId: string | null;
  districtId: string | null;
};

export type SittingDayVerdict = {
  sitting: boolean;
  /** Why not, when it is not a sitting day. Null when it is. */
  reason: string | null;
};

const appliesTo = (row: NonSittingDay, scope: CourtScope): boolean => {
  if (row.court_id) return row.court_id === scope.courtId;
  if (row.district_id) return row.district_id === scope.districtId;
  return true; // national
};

/** Saturday or Sunday. A rule, deliberately not 104 rows a year. */
export const isWeekend = (isoDate: string): boolean => {
  const day = parseDateOnly(isoDate).getDay();
  return day === 0 || day === 6;
};

export function sittingDayVerdict(
  isoDate: string,
  scope: CourtScope,
  rows: NonSittingDay[],
): SittingDayVerdict {
  const forDate = rows.filter((row) => row.holiday_date === isoDate && appliesTo(row, scope));

  // An explicit sitting exception beats the weekend rule and any holiday
  // recorded for the same day -- that is what it is for.
  if (forDate.some((row) => row.kind === "sitting_exception")) {
    return { sitting: true, reason: null };
  }

  // Most specific wins, so a court closure names itself over a national one.
  const blocking =
    forDate.find((row) => row.court_id) ??
    forDate.find((row) => row.district_id) ??
    forDate.find((row) => !row.court_id && !row.district_id);
  if (blocking) return { sitting: false, reason: blocking.name };

  if (isWeekend(isoDate)) {
    return {
      sitting: false,
      reason: parseDateOnly(isoDate).getDay() === 0 ? "a Sunday" : "a Saturday",
    };
  }
  return { sitting: true, reason: null };
}

/**
 * The next day the court sits, starting the day after `isoDate`.
 *
 * Bounded: an unrecorded year must not send this looping, and returning
 * the input unchanged would be a worse answer than none.
 */
export function nextSittingDay(
  isoDate: string,
  scope: CourtScope,
  rows: NonSittingDay[],
  maxDays = 60,
): string | null {
  const start = parseDateOnly(isoDate);
  for (let offset = 1; offset <= maxDays; offset += 1) {
    const candidate = new Date(start);
    candidate.setDate(candidate.getDate() + offset);
    const iso = `${candidate.getFullYear()}-${String(candidate.getMonth() + 1).padStart(2, "0")}-${String(candidate.getDate()).padStart(2, "0")}`;
    if (sittingDayVerdict(iso, scope, rows).sitting) return iso;
  }
  return null;
}
