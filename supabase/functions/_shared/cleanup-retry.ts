// What the storage-cleanup function writes to a queue row after a failed
// removal (0167): the attempt count, the error, and when the row is next
// due or dead-lettered, on the shared retry schedule (retry-schedule.ts).
// Pure, so scripts/tests/test-storage-cleanup-retry.mjs can check it
// without a database.

import { afterFailedAttempt } from "./retry-schedule.ts";

export { MAX_ATTEMPTS } from "./retry-schedule.ts";

export const afterFailedRemoval = (previousAttempts: number, error: string, now = Date.now()) => {
  const { attempts, next_attempt_at, dead_lettered_at } = afterFailedAttempt(previousAttempts, now);
  return { attempts, last_error: error, next_attempt_at, dead_lettered_at };
};
