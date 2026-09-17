/**
 * CSV formula-injection neutralisation in the audit export (§3.4).
 *
 *   node --experimental-strip-types --import ./scripts/test-support/register.mjs scripts/tests/test-audit-export-csv.mjs
 */
import { neutralizeCsvFormula, rowsToCsv } from "../../src/lib/audit-export.ts";

let failures = 0;
const check = (label, actual, expected) => {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} — ${label}`);
  if (!pass) {
    console.log("  expected:", JSON.stringify(expected));
    console.log("  actual:  ", JSON.stringify(actual));
    failures += 1;
  }
};

check("= prefixed", neutralizeCsvFormula('=HYPERLINK("http://x")'), '\'=HYPERLINK("http://x")');
check("+ prefixed", neutralizeCsvFormula("+cmd|' /C calc'!A0"), "'+cmd|' /C calc'!A0");
check("- prefixed", neutralizeCsvFormula("-1+1"), "'-1+1");
check("@ prefixed", neutralizeCsvFormula("@SUM(1)"), "'@SUM(1)");
check("tab prefixed", neutralizeCsvFormula("\t=1"), "'\t=1");
check("CR prefixed", neutralizeCsvFormula("\r=1"), "'\r=1");
check("ordinary text untouched", neutralizeCsvFormula("Magistrate One"), "Magistrate One");
check(
  "ISO timestamp untouched",
  neutralizeCsvFormula("2026-09-17T10:00:00Z"),
  "2026-09-17T10:00:00Z",
);
check("empty untouched", neutralizeCsvFormula(""), "");
check("leading space is not a trigger", neutralizeCsvFormula(" =1"), " =1");

const csv = rowsToCsv([
  ["When", "Actor"],
  ["2026-09-17T10:00:00Z", "=cmd|' /C calc'!A0"],
  ["2026-09-17T10:01:00Z", 'He said "hi"'],
]);
const lines = csv.split("\r\n");
check("header row unchanged", lines[0], '"When","Actor"');
check(
  "formula cell quoted and apostrophe-prefixed",
  lines[1],
  `"2026-09-17T10:00:00Z","'=cmd|' /C calc'!A0"`,
);
check(
  "quotes still doubled after neutralisation",
  lines[2],
  '"2026-09-17T10:01:00Z","He said ""hi"""',
);
check(
  "no cell begins with a formula leader after quoting",
  lines.slice(1).some((l) => /,"[=+\-@\t\r]/.test(l)),
  false,
);

console.log(failures > 0 ? `\n${failures} failure(s).` : "\nAll audit-export CSV tests passed.");
process.exit(failures > 0 ? 1 : 0);
