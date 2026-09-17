/**
 * getErrorMessage() is the last thing between a Postgres exception and a
 * toast a magistrate reads mid-sitting. These assertions pin the contract:
 * known codes map to plain English, raw driver text never leaks, and the
 * raw text still reaches engineering via reportError.
 *
 *   node --experimental-strip-types --import ./scripts/test-support/register.mjs scripts/tests/test-error-messages.mjs
 */
import { GENERIC_ERROR_MESSAGE, getErrorMessage } from "../../src/lib/utils.ts";
import { scrubText } from "../../src/lib/sentry.ts";

let failures = 0;
function check(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} — ${label}`);
  if (!pass) {
    console.log("  expected:", JSON.stringify(expected));
    console.log("  actual:  ", JSON.stringify(actual));
    failures += 1;
  }
}

// reportError falls back to console.error when Sentry is not initialised
// (it never is under Node). Capture it so the "raw text was reported"
// half of the contract is asserted, not assumed.
const reported = [];
const originalError = console.error;
console.error = (...args) => {
  reported.push(args);
};

// --- existing mappings are untouched ----------------------------------------
check(
  "unique violation on a known constraint",
  getErrorMessage({
    code: "23505",
    message: 'duplicate key value violates unique constraint "quick_codes_owner_code_word"',
  }),
  "You already have a Quick Code with that code word.",
);
check(
  "unique violation on an unknown constraint",
  getErrorMessage({
    code: "23505",
    message: 'duplicate key value violates unique constraint "some_other_idx"',
  }),
  "That already exists.",
);
check(
  "RLS denial",
  getErrorMessage({ code: "42501", message: "permission denied for table x" }),
  "You don't have permission to do that.",
);
check(
  "missing foreign key",
  getErrorMessage({ code: "23503", message: "violates foreign key" }),
  "That's linked to something that no longer exists.",
);
check(
  "PGRST116",
  getErrorMessage({
    code: "PGRST116",
    message: "JSON object requested, multiple (or no) rows returned",
  }),
  "That record doesn't exist, or you don't have access to it.",
);
check(
  "rate limited",
  getErrorMessage({ message: "rate_limited" }),
  "Too many requests. Try again in a minute.",
);
check(
  "plain Error passes its message through",
  getErrorMessage(new Error("Couldn't save the note.")),
  "Couldn't save the note.",
);
check("string passes through", getErrorMessage("Nope."), "Nope.");
check("nullish falls back", getErrorMessage(undefined), "An unexpected error occurred.");

// --- new: docket case number ----------------------------------------------
check(
  "docket case number collision maps to the district sentence",
  getErrorMessage({
    code: "23505",
    message:
      'duplicate key value violates unique constraint "docket_matters_district_case_number_unique"',
  }),
  "That case number already exists in this district.",
);

// --- new: raw database text never reaches a toast --------------------------
const RAW_SAMPLES = [
  { code: "PGRST301", message: "PGRST301: JWT expired" },
  { code: "23505", message: 'duplicate key value violates unique constraint "x"', codeless: true },
  { message: "permission denied for schema public" },
  {
    code: "23514",
    message: 'new row for relation "docket_matters" violates check constraint "chk"',
  },
  { code: "23502", message: 'null value in column "title" violates not-null constraint' },
  { code: "22P02", message: 'invalid input syntax for type uuid: "abc"' },
  { code: "P0001", message: "violates something we have not mapped yet" },
];
for (const sample of RAW_SAMPLES) {
  const { codeless, ...error } = sample;
  if (codeless) delete error.code; // force the generic path, not the 23505 map
  reported.length = 0;
  const shown = getErrorMessage(error);
  check(`generic sentence for "${error.message.slice(0, 40)}…"`, shown, GENERIC_ERROR_MESSAGE);
  check(
    `raw text for "${error.message.slice(0, 40)}…" is routed to reportError`,
    reported.some((args) =>
      args.some((arg) => arg && typeof arg === "object" && arg.raw === error.message),
    ),
    true,
  );
}

// A friendly message from our own code is not database text and is shown
// as written.
reported.length = 0;
check(
  "house copy is not caught by the raw-text guard",
  getErrorMessage({ message: "Couldn't load the docket." }),
  "Couldn't load the docket.",
);
check("house copy is not reported", reported.length, 0);

// --- Sentry scrubbing -------------------------------------------------------
check(
  "emails are scrubbed",
  scrubText("failed for magistrate.one@courts.gov.gy at 10:00"),
  "failed for [email] at 10:00",
);
check(
  "JWT-looking strings are scrubbed",
  scrubText(
    "token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c rejected",
  ),
  "token [token] rejected",
);
check(
  "ordinary dotted text is left alone",
  scrubText("docket.matters.v2 saved"),
  "docket.matters.v2 saved",
);

console.error = originalError;
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
