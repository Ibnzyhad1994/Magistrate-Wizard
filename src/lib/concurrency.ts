/**
 * Optimistic-concurrency guard reused across docket_matters mutations.
 * Reuses the table's existing `updated_at` column as the version marker
 * — no new schema needed. A mutation includes `.eq("updated_at",
 * expectedUpdatedAt)` alongside `.eq("id", id)`; if another authorized
 * user changed the row since it was read, zero rows match and the
 * conditional update becomes a safe no-op instead of a silent overwrite
 * — the caller distinguishes that case via this error type and shows the
 * conflict, never auto-merges.
 */
export class ConcurrentEditError extends Error {
  constructor() {
    super(
      "This matter was updated by another user while you were editing. Review the latest information before saving.",
    );
    this.name = "ConcurrentEditError";
  }
}

export function isConcurrentEditError(error: unknown): error is ConcurrentEditError {
  return error instanceof ConcurrentEditError;
}
