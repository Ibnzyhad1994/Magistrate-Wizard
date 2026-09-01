// Regression tests for src/lib/case-law-title.ts — Proper Case for
// case_law.case_name (never citations). Run with:
//   node --experimental-strip-types --import ./scripts/test-support/register.mjs scripts/tests/test-case-law-title.mjs

import { formatCaseLawTitle } from "@/lib/case-law-title"

let failures = 0
function check(label, actual, expected) {
  const pass = actual === expected
  console.log(`${pass ? "PASS" : "FAIL"} - ${label}`)
  if (!pass) {
    console.log("  expected:", JSON.stringify(expected))
    console.log("  actual:  ", JSON.stringify(actual))
    failures += 1
  }
}

check(
  "ALL CAPS harvest title",
  formatCaseLawTitle("MOHAMED IRFAAN ALI v ATTORNEY GENERAL"),
  "Mohamed Irfaan Ali v Attorney General",
)

check(
  "THE STATE party name",
  formatCaseLawTitle("THE STATE v DHANNIE RAMSINGH"),
  "The State v Dhannie Ramsingh",
)

check(
  "already Proper Case is idempotent",
  formatCaseLawTitle("The State v Dhannie Ramsingh"),
  "The State v Dhannie Ramsingh",
)

check(
  "vs connector stays lowercase",
  formatCaseLawTitle("SMITH vs JONES"),
  "Smith vs Jones",
)

check(
  "v. connector stays lowercase",
  formatCaseLawTitle("POLICE v. JOHN DOE"),
  "Police v. John Doe",
)

check(
  "DPP acronym preserved",
  formatCaseLawTitle("DPP v JOHN DOE"),
  "DPP v John Doe",
)

check(
  "R (Rex) acronym preserved",
  formatCaseLawTitle("R v SMITH"),
  "R v Smith",
)

check(
  "CCJ acronym preserved",
  formatCaseLawTitle("ATTORNEY GENERAL v CCJ"),
  "Attorney General v CCJ",
)

check(
  "Mc prefix",
  formatCaseLawTitle("MCDONALD v THE STATE"),
  "McDonald v The State",
)

check(
  "O' prefix",
  formatCaseLawTitle("O'BRIEN v DPP"),
  "O'Brien v DPP",
)

check(
  "untitled placeholder unchanged",
  formatCaseLawTitle("Untitled (pending review)"),
  "Untitled (pending review)",
)

check(
  "untitled placeholder case-insensitive",
  formatCaseLawTitle("UNTITLED (PENDING REVIEW)"),
  "Untitled (pending review)",
)

check(
  "small words mid-title stay lowercase",
  formatCaseLawTitle("RE ESTATE OF JOHN SMITH"),
  "Re Estate of John Smith",
)

check(
  "party after v is capitalized including The",
  formatCaseLawTitle("DOE v THE ATTORNEY GENERAL"),
  "Doe v The Attorney General",
)

check(
  "hyphenated party",
  formatCaseLawTitle("ATTORNEY-GENERAL v SMITH"),
  "Attorney-General v Smith",
)

check("empty string", formatCaseLawTitle("   "), "")
check("nullish", formatCaseLawTitle(null), "")

check(
  "whitespace collapsed",
  formatCaseLawTitle("  SMITH   v   JONES  "),
  "Smith v Jones",
)

if (failures > 0) {
  console.error(`\n${failures} failure(s)`)
  process.exit(1)
}
console.log("\nAll case-law title checks passed.")
