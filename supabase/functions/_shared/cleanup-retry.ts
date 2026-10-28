// What the storage-cleanup function writes to a queue row after a failed
// removal (0167): the attempt count, the error, when the row is next due
// (one minute after the first failure, doubling, capped at a day), and,
// once MAX_ATTEMPTS is reached, dead_lettered_at, after which no run takes
// the row again. Pure, so scripts/tests/test-storage-cleanup-retry.mjs can
// check it without a database.

export const MAX_ATTEMPTS = 8;
const FIRST_BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000;

export const afterFailedRemoval = (previousAttempts: number, error: string, now = Date.now()) => {
  const attempts = previousAttempts + 1;
  const backoff = Math.min(FIRST_BACKOFF_MS * 2 ** (attempts - 1), MAX_BACKOFF_MS);
  return {
    attempts,
    last_error: error,
    next_attempt_at: new Date(now + backoff).toISOString(),
    dead_lettered_at: attempts >= MAX_ATTEMPTS ? new Date(now).toISOString() : null,
  };
};
