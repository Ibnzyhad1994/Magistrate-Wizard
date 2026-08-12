import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind class names, resolving conflicts in favor of the
 * last-provided class. Used throughout the shadcn/ui primitives and
 * any component that accepts a `className` override prop.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parses a Postgres `date`-column value (a plain "YYYY-MM-DD" string with
 * no time or timezone component) into a JS `Date` representing LOCAL
 * midnight on that calendar day.
 *
 * ROOT CAUSE this exists to avoid: `new Date("2026-08-20")` is parsed by
 * the JS spec as **UTC midnight**, not local midnight. Formatting that
 * value with `Intl.DateTimeFormat` (which renders in the browser's LOCAL
 * timezone by default) then silently rolls the calendar date backward by
 * one day for every negative-UTC-offset timezone — including Guyana
 * (UTC-4). This is exactly the "20 Aug selected, 19 Aug displayed" bug:
 * UTC midnight on the 20th is 8:00 PM local time on the 19th in Guyana.
 * Constructing a `Date` from separate year/month/day components instead
 * (`new Date(y, m - 1, d)`) uses the LOCAL timezone at construction time,
 * so the calendar date can never shift — a `date` column's value is a
 * calendar date, not an instant, and must never be timezone-sensitive.
 */
export function parseDateOnly(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y as number, (m as number) - 1, d as number);
}

/**
 * Today's calendar date, as a "YYYY-MM-DD" string, in the VIEWER's LOCAL
 * timezone — safe to compare directly against a Postgres `date` column
 * (e.g. `.gte("scheduled_date", getLocalDateOnly())`).
 *
 * Deliberately NOT `new Date().toISOString().slice(0, 10)`: `toISOString`
 * always renders in UTC, so for any negative-UTC-offset timezone (Guyana,
 * UTC-4) that expression returns TOMORROW's date for several hours every
 * evening (e.g. 9:00 PM local Aug 19 in Guyana is already 1:00 AM UTC Aug
 * 20), which would silently drop today's remaining Upcoming Appearances
 * and pull in tomorrow's a day early. Building the string from local
 * `Date` accessors avoids that entirely.
 */
export function getLocalDateOnly(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Format a `date` (calendar-date-only) or `timestamptz` value for
 * display. Centralized here so date formatting/timezone handling stays
 * consistent — and correct — across the app.
 *
 * Accepts either: a plain "YYYY-MM-DD" string (a Postgres `date` column
 * — parsed via `parseDateOnly` so the calendar day can never shift with
 * timezone, see above), or a full ISO timestamp string / `Date` (a
 * `timestamptz` column, e.g. `created_at`/`finalized_at` — these
 * genuinely represent an instant and are correctly rendered in the
 * viewer's local time, which is intentional and unchanged).
 */
export function formatDate(
  date: string | Date,
  options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "numeric",
  },
): string {
  const d =
    typeof date === "string"
      ? DATE_ONLY_RE.test(date)
        ? parseDateOnly(date)
        : new Date(date)
      : date;
  // en-GB (Commonwealth) ordering — "20 Aug 2026", day before month —
  // per the Guyana/Commonwealth judicial date-presentation standard.
  // Never en-US, which would read as month-first.
  return new Intl.DateTimeFormat("en-GB", options).format(d);
}

export function formatDateTime(date: string | Date): string {
  return formatDate(date, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Format a Postgres `time`-column value ("HH:MM" or "HH:MM:SS", no
 * timezone — a wall-clock time, not an instant) as a clean 12-hour
 * string, e.g. "14:30:00" -> "2:30 PM". Deliberately does NOT go through
 * `Date`/`Intl` timezone conversion at all — a bare `time` value has no
 * timezone to convert, and running it through `new Date()` would invite
 * exactly the same class of bug as the date-only case above.
 */
export function formatTimeOnly(value: string | null | undefined): string {
  if (!value) return "";
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return value;
  const hour24 = Number(match[1]);
  const minute = match[2];
  const period = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${minute} ${period}`;
}

/* ------------------------------------------------------------------ *
 * STRICT DATE / TIME / TIMESTAMPTZ DISTINCTION
 *
 * Three, and only three, kinds of value flow through this app's date
 * handling, and each has its own contract:
 *
 *  - DATE (calendar-only): `docket_events.scheduled_date`,
 *    `judgments.judgment_date`, `case_law.decided_date`,
 *    `statutes.effective_date`, legacy `cases.filed_date`/`closed_date`.
 *    Represented ONLY as a plain "YYYY-MM-DD" string end-to-end — never
 *    parsed via `new Date(dateOnlyString)` (UTC-midnight parsing), never
 *    round-tripped through `.toISOString()`. Display: `DD/MM/YYYY` in
 *    edit controls (`toDDMMYYYY`/`DateOnlyInput`), "20 Aug 2026" in
 *    read-only prose (`formatDate`, en-GB). `parseDateOnly` exists only
 *    to build a LOCAL-midnight `Date` for `Intl.DateTimeFormat`/calendar
 *    grid math — the calendar day cannot shift because construction and
 *    formatting always happen in the same local zone.
 *
 *  - TIME (clock-only): `docket_events.scheduled_time`. Represented as a
 *    plain "HH:MM[:SS]" string. Never constructs a `Date` at all
 *    (`formatTimeOnly` above) — a bare `time` value has no timezone, so
 *    there is nothing to convert and no correct way to put it through
 *    `Date`/`Intl`.
 *
 *  - TIMESTAMPTZ (instant): `created_at`, `updated_at`, `finalized_at`,
 *    `started_at`/`ended_at` (`magistrate_courts`,
 *    `docket_matter_assignments`), `shares.created_at`/`revoked_at`, etc.
 *    These genuinely represent a moment in time and are correctly
 *    handled with ordinary timezone-aware `new Date(isoString)` +
 *    viewer-local `Intl` rendering (`formatDate`'s non-date-only branch,
 *    `formatDateTime`) — this is intentional, not a bug, and must not be
 *    "fixed."
 * ------------------------------------------------------------------ */

/**
 * DATE-only display for edit controls: "2026-08-20" -> "20/08/2026".
 * Distinct from `formatDate`'s prose rendering ("20 Aug 2026") — this is
 * the exact DD/MM/YYYY numeric form `DateOnlyInput` reads and writes.
 */
export function toDDMMYYYY(value: string | null | undefined): string {
  if (!value || !DATE_ONLY_RE.test(value)) return "";
  const [y, m, d] = value.split("-");
  return `${d}/${m}/${y}`;
}

/**
 * Strictly parses a "DD/MM/YYYY" string into a `date`-column-ready
 * "YYYY-MM-DD" string, or `null` if it isn't a complete, real calendar
 * date (wrong length, month out of range, day that doesn't exist in
 * that month — e.g. "31/02/2026", "30/02/2028" non-leap-year). Validates
 * by constructing a LOCAL `Date` (`new Date(year, month-1, day)` — same
 * safe local-construction technique as `parseDateOnly`, never a
 * date-string-to-UTC parse) and confirming it round-trips to the exact
 * same year/month/day via local getters; a rolled-over value (e.g. Feb
 * 30 becoming Mar 2) fails the round-trip and is correctly rejected.
 */
export function parseDDMMYYYYToISO(text: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Masks free-typed digits into a "DD/MM/YYYY" shape as the user types
 * (auto-inserts "/" after the day and month segments, caps at 8 digits)
 * — used by `DateOnlyInput`. Pure string manipulation, no `Date`
 * involved, so there is nothing here that could ever be timezone-
 * sensitive.
 */
export function maskDDMMYYYY(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  let out = digits.slice(0, 2);
  if (digits.length > 2) out += "/" + digits.slice(2, 4);
  if (digits.length > 4) out += "/" + digits.slice(4, 8);
  return out;
}

/**
 * Turns a stored lowercase/snake_case categorical value (a Docket Matter
 * status, party role/type, event status, share permission, etc.) into a
 * professionally capitalized display label, e.g. "government_body" ->
 * "Government Body", "entered_in_error" -> "Entered In Error". Purely a
 * display-layer transform — never changes the underlying stored value,
 * which every CHECK constraint, RLS predicate, and STATUS_VARIANT-style
 * lookup elsewhere in the app continues to compare against unchanged.
 */
export function toTitleCase(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .replace(/_/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Produce initials from a display name, e.g. "Jane Doe" -> "JD".
 * Falls back to the first two characters if only one word is given.
 */
export function getInitials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

/**
 * Sleep helper, primarily useful for deliberate UX delays or backoff.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Known Postgres/PostgREST error codes mapped to constraint-name substrings
 * we can recognize, so common failures surface as plain English instead of
 * raw Postgres exception text. Extend this map as new constraints are hit
 * rather than displaying the raw driver message.
 */
const UNIQUE_VIOLATION_MESSAGES: Array<[substring: string, message: string]> = [
  ["quick_codes_owner_code_word", "You already have a Quick Code with that code word."],
  ["bookmarks_user_id_entity_type_entity_id", "You've already bookmarked this."],
  ["docket_matter_tags", "That tag is already on this matter."],
  ["judgment_tags", "That tag is already on this judgment."],
  // A canonical Case Law citation collision (case_law_citation_canonical_
  // unique_idx, 0035) — without this entry the generic "That already
  // exists." fallback below fires instead, which is indistinguishable
  // from a genuine processing failure in the bulk-import queue (found via
  // live testing: 4/7 bulk PDFs sharing a citation with an already-
  // published canonical record all surfaced as "Failed"). This mapping is
  // a defense-in-depth backstop — the primary fix is the pre-insert
  // citation-conflict check in use-import-jobs.ts, which should normally
  // prevent this constraint from ever firing in practice.
  ["case_law_citation_canonical_unique_idx", "A canonical case with this citation already exists."],
];

/**
 * Type guard for narrowing unknown errors (e.g. from catch blocks or
 * Supabase/PostgREST responses) down to a human-readable message. Where
 * possible, recognizes common Postgres error codes (unique violations,
 * RLS denials, missing foreign keys) and returns plain English instead of
 * the raw driver/Postgres exception text.
 */
export function getErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const code = "code" in error ? String((error as { code: unknown }).code) : undefined;
    const rawMessage =
      "message" in error && typeof (error as { message: unknown }).message === "string"
        ? (error as { message: string }).message
        : undefined;

    if (code === "23505") {
      const match = UNIQUE_VIOLATION_MESSAGES.find(([substring]) =>
        rawMessage?.toLowerCase().includes(substring.toLowerCase()),
      );
      return match?.[1] ?? "That already exists.";
    }
    if (code === "42501") {
      return "You don't have permission to do that.";
    }
    if (code === "23503") {
      return "That's linked to something that no longer exists.";
    }
    if (code === "PGRST116") {
      return "That record doesn't exist, or you don't have access to it.";
    }
    if (
      typeof (error as { message?: unknown }).message === "string" &&
      /network|fetch/i.test((error as { message: string }).message) &&
      !navigator.onLine
    ) {
      return "You appear to be offline. Check your connection and try again.";
    }
    if (rawMessage) return rawMessage;
  }
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "An unexpected error occurred.";
}
