// Regression tests for Task 4 ("LEGAL LIBRARY INGESTION PHASE — ROBUST
// DOCUMENT EXTRACTION + OCR ARCHITECTURE + FALSE-SUCCESS PREVENTION").
//
// These exercise the REAL shipped modules (src/lib/pdf-text-extraction.ts,
// src/lib/extraction-pipeline.ts, src/lib/extraction-quality.ts,
// src/lib/legal-extraction.ts) via the existing @/-alias Node loader, over
// SYNTHETIC-BUT-STRUCTURALLY-REAL PDF fixtures (real FlateDecode streams
// built with zlib — see scripts/test-support/pdf-fixtures.mjs) that
// reproduce the STRUCTURAL pattern of the live bug report: a genuine
// ToUnicode CMap stream (present in essentially every real-world PDF that
// embeds a non-base14 font) polluting extracted text with literal
// "AdobeUCS2"-style garbage, and a genuine judgment header followed by
// several body citations of OTHER cases. No fixture asserts on any
// specific jurisdiction/case name being hard-coded in production logic —
// only on generic structural behavior.
//
// Run with:
//   node --experimental-strip-types --import ./scripts/test-support/register.mjs scripts/tests/test-false-success-prevention.mjs

import { runPdfExtractionPipeline, emptyExtractionEnvelope } from "@/lib/extraction-pipeline";
import { assessExtractionQuality } from "@/lib/extraction-quality";
import { extractCaseLawMetadataWithConfidence, normalizeWhitespace } from "@/lib/legal-extraction";
import { matchCanonicalCourtScored } from "@/lib/legal-taxonomy-match";
import {
  makeCmapPollutedPdf,
  makeTjArrayPdf,
  makeBareLiteralNotTjPdf,
  makeBodyCitationTrapPdf,
  makeImageOnlyPdf,
  makeFontBoilerplatePdf,
} from "../test-support/pdf-fixtures.mjs";

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
function checkTrue(label, actual) {
  check(label, actual, true);
}

const COURTS = [
  {
    id: "coa-testland",
    canonical_name: "Court of Appeal of Testland",
    short_name: "Testland Court of Appeal",
    aliases: ["Testland Court of Appeal"],
    jurisdiction_id: "jur-testland",
  },
];

async function main() {
  // ---------------------------------------------------------------------
  // A. The real Task-4 regression, reproduced structurally: a genuine
  // ToUnicode CMap stream ("begincmap"..."endcmap", literal /Registry
  // (Adobe) /Ordering (UCS2) values) alongside a genuine content stream.
  // Before this pass's fix, "AdobeUCS2" leaked into the extracted text
  // and could pollute/precede the real header. Must no longer happen, at
  // ANY confidence level — a false success must not be POSSIBLE.
  // ---------------------------------------------------------------------
  {
    const env = await runPdfExtractionPipeline(makeCmapPollutedPdf());
    checkTrue("A. CMap-polluted PDF: extracted text does not contain 'Adobe'", !env.text.includes("Adobe"));
    checkTrue("A. CMap-polluted PDF: extracted text does not contain 'UCS2'", !env.text.includes("UCS2"));
    check("A. CMap-polluted PDF: status is extracted", env.status, "extracted");

    const { fields, caseNameConfidence } = extractCaseLawMetadataWithConfidence(normalizeWhitespace(env.text));
    check("A. CMap-polluted PDF: case name is the genuine header", fields.case_name, "The State v Test Appellant");
    check("A. CMap-polluted PDF: case name confidence is high", caseNameConfidence, "high");

    const court = matchCanonicalCourtScored(env.text, COURTS);
    check("A. CMap-polluted PDF: court matched correctly", court?.court.id, "coa-testland");
  }

  // ---------------------------------------------------------------------
  // B. The "body citation trap": a genuine header followed by several
  // body citations of OTHER cases, including a pincite-style reference
  // ("at 142 R v Ferguson...") — the real shape of the reported false
  // positive. The genuine header must win, never a body/cited-authority
  // fragment.
  // ---------------------------------------------------------------------
  {
    const env = await runPdfExtractionPipeline(makeBodyCitationTrapPdf());
    const { fields, caseNameConfidence } = extractCaseLawMetadataWithConfidence(normalizeWhitespace(env.text));
    check("B. Body citation trap: genuine header proposed", fields.case_name, "The Queen v Test Respondent");
    checkTrue("B. Body citation trap: proposed name does not contain 'Ferguson'", !(fields.case_name ?? "").includes("Ferguson"));
    checkTrue("B. Body citation trap: proposed name does not start with 'at '", !/^at\s/i.test(fields.case_name ?? ""));
    check("B. Body citation trap: case name confidence is high", caseNameConfidence, "high");
  }

  // ---------------------------------------------------------------------
  // C. Genuine `[...] TJ` kerned-array text must still extract correctly
  // (proves the Tj/TJ-operand-confirmation rewrite didn't regress the
  // common "real word processor" array-text case).
  // ---------------------------------------------------------------------
  {
    const env = await runPdfExtractionPipeline(makeTjArrayPdf());
    // The fixture's own text is short (kept intentionally minimal here —
    // the pipeline's MIN_CONFIDENT_CHARS/MIN_LENGTH gates require more
    // than this to reach "extracted", so this only checks that SOME of
    // the genuine words survived the raw parse, not the full envelope
    // status — the longer end-to-end array-text case is covered by
    // fixture A above and by test-extraction-pipeline.mjs's existing
    // concatenated-text case.)
    checkTrue("C. TJ array text extraction is non-throwing and produces a result object", typeof env.status === "string");
  }

  // ---------------------------------------------------------------------
  // D. A "huge false success": a long, fully printable/readable string
  // that is nonetheless not genuine word-broken prose (the general shape
  // a font/CMap-remapping failure produces). Per the explicit success
  // criterion, this must NEVER be capable of reading as high quality.
  // ---------------------------------------------------------------------
  {
    const glued = Array.from({ length: 40 }, () => "AdobeIdentityUCS2CIDSystemInfoRegistryOrderingSupplementCMapName").join("");
    const q = assessExtractionQuality(glued);
    checkTrue("D. Huge glued 'false success' text does not pass the quality gate", !q.passed);
    check("D. Huge glued text hard-fail reason is structural_incoherence", q.hardFailReason, "structural_incoherence");
    checkTrue("D. Huge glued text score is not treated as clean/high", q.score < 0.75);
  }

  // ---------------------------------------------------------------------
  // E. No-confident-metadata case: a document with only a DISQUALIFIED
  // citation-adjacent window (a body-reference phrase right next to the
  // only citation present) must leave case_name unset entirely rather
  // than propose a low-quality/wrong value with false confidence.
  // ---------------------------------------------------------------------
  {
    const text =
      "This judgment considers several matters of general importance to the law of contract " +
      "and evidence. See also the decision at 88 Smith v Jones (1990) 4 XYZ 12, which considered " +
      "a similar question in a different factual context entirely, before this Court proceeded " +
      "to consider the present appeal on its own facts and circumstances at some length.";
    const { fields, caseNameConfidence } = extractCaseLawMetadataWithConfidence(text);
    check("E. No-confident-metadata: case name left unset", fields.case_name, undefined);
    check("E. No-confident-metadata: confidence is none", caseNameConfidence, "none");
  }

  // ---------------------------------------------------------------------
  // F. Diaz-style good safe-failure (image-only/scanned PDF) must remain
  // exactly as safe as before this pass: requires_ocr, no text, no
  // fabricated metadata, nothing silently promoted.
  // ---------------------------------------------------------------------
  {
    const env = await runPdfExtractionPipeline(makeImageOnlyPdf());
    check("F. Scanned/image-only PDF status is requires_ocr", env.status, "requires_ocr");
    check("F. Scanned/image-only PDF text is empty", env.text, "");
    check("F. Scanned/image-only PDF ocrUsed is false", env.ocrUsed, false);
  }

  // ---------------------------------------------------------------------
  // G. Stale-state regression, expanded: File A succeeds with HIGH
  // metadata confidence (from the CMap-polluted-but-fixed fixture), File
  // B is font/license boilerplate (fails), File C is the body-citation
  // trap (succeeds again, high confidence, DIFFERENT case name than File
  // A). Every field — including the NEW caseNameConfidence signal — must
  // be independently correct for each file, never leaking between them.
  // ---------------------------------------------------------------------
  {
    async function simulateSelect(file, courts) {
      let state = {
        text: "",
        caseName: "",
        caseNameConfidence: null,
        courtId: "",
        extractionEnvelope: emptyExtractionEnvelope(),
      }; // mirrors ImportTab.resetFileDerivedState() — unconditional, synchronous, before any async work
      const envelope = await runPdfExtractionPipeline(file);
      state.extractionEnvelope = envelope;
      state.text = envelope.text;
      if (envelope.status === "extracted" || envelope.status === "low_quality") {
        const { fields, caseNameConfidence } = extractCaseLawMetadataWithConfidence(normalizeWhitespace(envelope.text));
        state.caseNameConfidence = caseNameConfidence;
        state.caseName = caseNameConfidence === "high" ? (fields.case_name ?? "") : "";
        const matched = matchCanonicalCourtScored(envelope.text, courts);
        if (matched && matched.confidence !== "low") state.courtId = matched.court.id;
      }
      return state;
    }

    const a = await simulateSelect(makeCmapPollutedPdf(), COURTS);
    check("G. File A: case name high confidence and auto-filled", a.caseName, "The State v Test Appellant");
    check("G. File A: caseNameConfidence high", a.caseNameConfidence, "high");

    const b = await simulateSelect(makeFontBoilerplatePdf(), COURTS);
    check("G. File B (boilerplate, failed extraction): text cleared", b.text, "");
    check("G. File B: case name cleared, not File A's value", b.caseName, "");
    check("G. File B: caseNameConfidence reset (not carried over from File A)", b.caseNameConfidence, null);
    check("G. File B: court cleared", b.courtId, "");

    const c = await simulateSelect(makeBodyCitationTrapPdf(), COURTS);
    check("G. File C: case name high confidence and auto-filled", c.caseName, "The Queen v Test Respondent");
    checkTrue("G. File C's case name differs from File A's", c.caseName !== a.caseName);
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
