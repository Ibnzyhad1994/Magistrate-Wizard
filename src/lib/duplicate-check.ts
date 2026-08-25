/**
 * Exact-duplicate / citation-conflict query interpretation.
 * A network or PostgREST error must never be treated as "no duplicate"
 * — that would let a second copy of a file through on a blip.
 */

export class DuplicateCheckError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "DuplicateCheckError"
  }
}

const BLOCKING_MESSAGE =
  "Could not verify whether this file is a duplicate. Import blocked until the check succeeds."

export const interpretDuplicateQuery = <T>(
  result: { data: T[] | null; error: { message?: string } | null },
  mapRow: (row: T) => { id: string; label: string },
): { id: string; label: string } | null => {
  if (result.error) {
    const detail = result.error.message?.trim()
    throw new DuplicateCheckError(detail ? `${BLOCKING_MESSAGE} (${detail})` : BLOCKING_MESSAGE)
  }
  const row = result.data?.[0]
  return row ? mapRow(row) : null
}
