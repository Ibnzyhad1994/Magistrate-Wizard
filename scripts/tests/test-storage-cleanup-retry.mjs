/**
 * The storage-cleanup function's retry rule (0167, BE-07): a failed removal
 * is retried one minute later, then with a doubling delay capped at a day,
 * and dead-lettered on its eighth attempt so it can never block the queue.
 * The live half, that runs skip rows that are not due or dead-lettered, is
 * test-storage-cleanup-schedule.mjs.
 *
 *   npm run test:storage-cleanup-retry
 */
import {
  MAX_ATTEMPTS,
  afterFailedRemoval,
} from "../../supabase/functions/_shared/cleanup-retry.ts";

let failures = 0;
function check(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} - ${label}`);
  if (!pass) {
    console.log("  expected:", JSON.stringify(expected));
    console.log("  actual:  ", JSON.stringify(actual));
    failures += 1;
  }
}

const NOW = Date.parse("2026-10-28T12:00:00.000Z");
const MINUTE = 60_000;
const delayAfter = (previousAttempts) =>
  (Date.parse(afterFailedRemoval(previousAttempts, "boom", NOW).next_attempt_at) - NOW) / MINUTE;

{
  const first = afterFailedRemoval(0, "Bucket unavailable", NOW);
  check("the first failure counts one attempt", first.attempts, 1);
  check("the first failure keeps the error", first.last_error, "Bucket unavailable");
  check("the first failure is retried a minute later", delayAfter(0), 1);
  check("the first failure is not dead-lettered", first.dead_lettered_at, null);
}
check("the delay doubles", [1, 2, 3, 4].map(delayAfter), [2, 4, 8, 16]);
check("the delay is capped at a day", delayAfter(20), 24 * 60);
check("eight attempts is the limit", MAX_ATTEMPTS, 8);
check(
  "the seventh failure is still retried",
  afterFailedRemoval(MAX_ATTEMPTS - 2, "boom", NOW).dead_lettered_at,
  null,
);
check(
  "the eighth failure dead-letters the row",
  afterFailedRemoval(MAX_ATTEMPTS - 1, "boom", NOW).dead_lettered_at,
  new Date(NOW).toISOString(),
);

console.log(
  failures > 0 ? `\n${failures} failure(s).` : "\nAll storage-cleanup retry tests passed.",
);
process.exit(failures > 0 ? 1 : 0);
