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

/**
 * Format a Date (or ISO string) using the platform Intl API.
 * Centralized here so date formatting stays consistent across the app.
 */
export function formatDate(
  date: string | Date,
  options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "numeric",
  },
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-US", options).format(d);
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
