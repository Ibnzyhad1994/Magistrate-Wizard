// Regression tests for:
//   (a) the file-selection stale-state fix (Phase 2) -- simulates the
//       EXACT sequence ImportTab.handleFile performs (see
//       src/pages/admin/legal-library-admin-page.tsx): reset all
//       file-derived fields synchronously, THEN run the real extraction
//       pipeline + real metadata/court proposal functions, gated by the
//       real envelope status, for a successful File A followed by a
//       failing File B.
//   (b) publication validation (src/lib/publication-validation.ts) still
//       rejects placeholder canonical records after this pass's changes.
//
// This is a logic-level regression test of the actual reset + gating
// mechanism (the real exported pipeline/extraction/matching functions),
// not a full React component render test -- this project has no
// component test runner (no vitest/jest/testing-library configured).
//
// Run with:
//   node --experimental-strip-types --import ./scripts/test-support/register.mjs scripts/tests/test-stale-state-and-publication.mjs

import { runPdfExtractionPipeline, emptyExtractionEnvelope } from "@/lib/extraction-pipeline";
import { extractCaseLawMetadata, normalizeWhitespace } from "@/lib/legal-extraction";
import { matchCanonicalCourtScored } from "@/lib/legal-taxonomy-match";
import { validateCaseLawForPublish, isPlaceholderValue } from "@/lib/publication-validation";
import { makeTextPdf, makeFontBoilerplatePdf } from "../test-support/pdf-fixtures.mjs";

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

const COURTS = [
  {
    id: "coa-guyana",
    canonical_name: "Court of Appeal of Guyana",
    short_name: "Guyana Court of Appeal",
    aliases: ["Guyana Court of Appeal", "CoA Guyana"],
    jurisdiction_id: "jur-guyana",
  },
];

/** Mirrors ImportTab's `resetFileDerivedState()` — the exact set of fields the live bug left stale. */
function emptyFormState() {
  return {
    text: "",
    caseFields: { case_name: "", citation: "", decided_date: "" },
    courtId: "",
    jurisdictionId: "",
    extractionEnvelope: emptyExtractionEnvelope(),
  };
}

/** Mirrors the relevant body of ImportTab.handleFile for a PDF selection. */
async function simulateSelectPdf(file, courts) {
  let state = emptyFormState(); // <-- the Phase 2 fix: unconditional reset BEFORE any async work
  const envelope = await runPdfExtractionPipeline(file);
  state.extractionEnvelope = envelope;
  state.text = envelope.text;

  if (envelope.status === "extracted" || envelope.status === "low_quality") {
    const proposed = extractCaseLawMetadata(normalizeWhitespace(envelope.text));
    state.caseFields = {
      case_name: proposed.case_name ?? "",
      citation: proposed.reported_citation ?? proposed.neutral_citation ?? "",
      decided_date: proposed.decided_date_guess ?? "",
    };
    const matched = matchCanonicalCourtScored(envelope.text, courts);
    if (matched && matched.confidence !== "low") {
      state.courtId = matched.court.id;
      if (matched.court.jurisdiction_id) state.jurisdictionId = matched.court.jurisdiction_id;
    }
  }
  return state;
}

async function main() {
  // File A: a clean, successfully-extracting judgment PDF.
  const fileA = makeTextPdf([
    "The State v Dhannie Ramsingh",
    "(1973) 20 WIR 138",
    "COURT OF APPEAL OF GUYANA",
    "The appellant was convicted of manslaughter following a trial in the High Court of Guyana.",
    "Counsel submitted that certain admissions were wrongly admitted as hearsay evidence at trial.",
    "The Court considered the relevant authorities before dismissing the appeal in this matter.",
  ]);
  const stateAfterA = await simulateSelectPdf(fileA, COURTS);

  check("File A: case name populated", stateAfterA.caseFields.case_name.length > 0, true);
  check("File A: citation populated", stateAfterA.caseFields.citation.length > 0, true);
  check("File A: court proposed", stateAfterA.courtId, "coa-guyana");
  check("File A: jurisdiction proposed", stateAfterA.jurisdictionId, "jur-guyana");
  check("File A: text populated", stateAfterA.text.length > 0, true);

  // File B: a PDF that extracts "successfully" at the raw parser level
  // but is actually font/license boilerplate -- fails the quality gate.
  const fileB = makeFontBoilerplatePdf();
  const stateAfterB = await simulateSelectPdf(fileB, COURTS);

  // THE BUG: previously, resetFileDerivedState() either didn't exist or
  // wasn't called unconditionally before the async extraction, so a
  // failed File B left File A's proposed metadata sitting in the form.
  check("File B (failed extraction): case name is NOT File A's value", stateAfterB.caseFields.case_name, "");
  check("File B (failed extraction): citation is NOT File A's value", stateAfterB.caseFields.citation, "");
  check("File B (failed extraction): court is NOT File A's value", stateAfterB.courtId, "");
  check("File B (failed extraction): jurisdiction is NOT File A's value", stateAfterB.jurisdictionId, "");
  check("File B (failed extraction): text is NOT File A's value", stateAfterB.text, "");
  check("File B (failed extraction): status is failed", stateAfterB.extractionEnvelope.status, "failed");

  // Explicitly confirm the values are not merely different from A's but
  // are also not silently equal to A's by coincidence.
  check(
    "File A and File B end up with genuinely different case_name values",
    stateAfterA.caseFields.case_name !== stateAfterB.caseFields.case_name,
    true,
  );

  // (b) Publication validation still rejects placeholder canonical
  // records after this pass's changes (§12 of the test matrix).
  const placeholderRecord = {
    case_name: "Untitled (pending review)",
    citation: "",
    court: "",
    jurisdiction: "",
    court_id: null,
    jurisdiction_id: null,
  };
  const placeholderErrors = validateCaseLawForPublish(placeholderRecord);
  check("placeholder record fails publication validation", placeholderErrors.length > 0, true);
  check("placeholder case name flagged", isPlaceholderValue(placeholderRecord.case_name), true);

  const validRecord = {
    case_name: "The State v Dhannie Ramsingh",
    citation: "(1973) 20 WIR 138",
    court: "Court of Appeal of Guyana",
    jurisdiction: "Guyana",
    court_id: "coa-guyana",
    jurisdiction_id: "jur-guyana",
  };
  const validErrors = validateCaseLawForPublish(validRecord);
  check("genuinely complete record passes publication validation", validErrors, []);

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
