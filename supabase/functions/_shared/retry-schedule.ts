// The retry schedule both scheduled Edge Functions use after a failure
// (storage-cleanup 0167, webhook-dispatch 0180): retried one minute after
// the first failure, then with a doubling delay capped at a day, and
// dead-lettered once MAX_ATTEMPTS is reached, after which no run takes the
// row again. Pure, so the scripts/tests can check it without a database.

export const MAX_ATTEMPTS = 8;
const FIRST_BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000;

export const afterFailedAttempt = (previousAttempts: number, now = Date.now()) => {
  const attempts = previousAttempts + 1;
  const backoff = Math.min(FIRST_BACKOFF_MS * 2 ** (attempts - 1), MAX_BACKOFF_MS);
  return {
    attempts,
    next_attempt_at: new Date(now + backoff).toISOString(),
    dead_lettered_at: attempts >= MAX_ATTEMPTS ? new Date(now).toISOString() : null,
  };
};
