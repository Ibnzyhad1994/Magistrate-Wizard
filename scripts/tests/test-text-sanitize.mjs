// Regression tests for src/lib/text-sanitize.ts - the Unicode
// sanitization boundary (Phase 5 of the holistic ingestion repair pass).
// Run with:
//   node --experimental-strip-types --import ./scripts/test-support/register.mjs scripts/tests/test-text-sanitize.mjs

import { sanitizeExtractedText } from "@/lib/text-sanitize";

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

// All test characters constructed via String.fromCharCode (never typed as
// literal invisible bytes in this source file) so the fixture is
// unambiguous regardless of how this file gets encoded/transmitted.
const NUL = String.fromCharCode(0x00);
const UNPAIRED_HIGH_SURROGATE = String.fromCharCode(0xd800);
const SOH = String.fromCharCode(0x01); // arbitrary C0 control character
const DEL = String.fromCharCode(0x7f);
const C1_CONTROL = String.fromCharCode(0x90);

// NUL bytes removed -- this is the exact root cause of the observed
// "unsupported Unicode escape sequence" Postgres/jsonb failure.
{
  const input = "The State v Test" + NUL + " Case (1973) 20 WIR 138";
  const r = sanitizeExtractedText(input);
  check("NUL byte removed", r.text, "The State v Test Case (1973) 20 WIR 138");
  check("hadNulBytes flag set", r.hadNulBytes, true);
  check("removedCount = 1", r.removedCount, 1);
}

// Unpaired (invalid) surrogate removed, valid surrogate PAIR preserved.
{
  const lone = "Before" + UNPAIRED_HIGH_SURROGATE + "After";
  const r1 = sanitizeExtractedText(lone);
  check("unpaired surrogate removed", r1.text, "BeforeAfter");
  check("hadInvalidSurrogates flag set", r1.hadInvalidSurrogates, true);

  const validPair = "Emoji:\u{1F600}End"; // a real, valid surrogate pair (grinning face emoji)
  const r2 = sanitizeExtractedText(validPair);
  check("valid surrogate pair preserved", r2.text, validPair);
  check("valid pair does not trigger hadInvalidSurrogates", r2.hadInvalidSurrogates, false);
}

// Other control characters removed, but \t \n \r preserved.
{
  const input = "Line one\nLine" + SOH + "two\rEnd";
  const r = sanitizeExtractedText(input);
  check("control chars removed, whitespace preserved", r.text, "Line one\nLinetwo\rEnd");
  check("hadOtherControlChars flag set", r.hadOtherControlChars, true);
}

// C1 control block (0x7F-0x9F) removed.
{
  const input = "Before" + DEL + "Middle" + C1_CONTROL + "After";
  const r = sanitizeExtractedText(input);
  check("C1 control chars removed", r.text, "BeforeMiddleAfter");
}

// Legitimate legal-document Unicode is NEVER touched -- this is the
// "do not solve this by flattening everything to ASCII" requirement.
{
  const legit =
    "The applicant’s counsel submitted — citing R v Smith § 12 — " +
    "that the appellant’s “confession” was inadmissible. Costs: $12°. " +
    "Parties: André François, José Suárez, Muñoz ¶ 4.";
  const r = sanitizeExtractedText(legit);
  check("legitimate Unicode text passes through unchanged", r.text, legit);
  check("no removals for clean legal text", r.removedCount, 0);
}

// Nothing to sanitize -- clean ASCII text is a pure no-op.
{
  const clean = "The State v Dhannie Ramsingh (1973) 20 WIR 138";
  const r = sanitizeExtractedText(clean);
  check("clean ASCII unchanged", r.text, clean);
  check("clean ASCII removedCount 0", r.removedCount, 0);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
