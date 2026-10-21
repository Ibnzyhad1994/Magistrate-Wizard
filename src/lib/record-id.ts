/**
 * Every record a detail page opens (matter, judgment, case law, statute,
 * provision, bench note, callover) is keyed by a `gen_random_uuid()` id.
 * A path segment that is not a UUID can never name one, so it is not
 * found: asking the API anyway only earns a 400 (`22P02`, invalid text
 * representation), an error toast and a Retry button for a request that
 * can never succeed.
 */
const RECORD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The id when it can name a record, otherwise `undefined` (which leaves id-keyed queries idle). */
export function recordIdOrUndefined(value: string | undefined): string | undefined {
  return value !== undefined && RECORD_ID.test(value) ? value : undefined;
}

/**
 * True when a failed read means "there is no such record" rather than a
 * fault worth retrying: `PGRST116` (`.single()` matched no row) and
 * `22P02` (the id was not valid UUID syntax).
 */
export function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  const code = String((error as { code: unknown }).code);
  return code === "PGRST116" || code === "22P02";
}
