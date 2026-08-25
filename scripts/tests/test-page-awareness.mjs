// Regression tests for page-aware PDF extraction (PRODUCTION DOCUMENT
// INGESTION PHASE, Section 5/6/34) against REAL FlateDecode-compressed PDF
// fixtures (see scripts/test-support/pdf-fixtures.mjs) — exercises the
// findPageMarkerOffsets/resolvePageIndex page-attribution heuristic in
// src/lib/pdf-text-extraction.ts and the pushWithSpacingHeuristic
// word-boundary fix, both through the same runPdfExtractionPipeline entry
// point ImportTab/the bulk worker actually call, plus the page-prioritized
// metadata extraction in src/lib/legal-extraction.ts.
//
// These are synthetic fixtures (see that file's header for why — no PDF
// library/network access to obtain real historical judgment PDFs in this
// sandbox), built to reproduce the STRUCTURAL patterns this phase's live
// testing (Ramsingh) actually exhibited: multiple pages, and text glued
// together across a page-footer/next-page-header boundary with no space.
//
// Run with:
//   node --experimental-strip-types --import ./scripts/test-support/register.mjs scripts/tests/test-page-awareness.mjs

import { runPdfExtractionPipeline } from "@/lib/extraction-pipeline";
import { extractCaseLawMetadataWithConfidence } from "@/lib/legal-extraction";
import { makeMultiPagePdf, makeGluedTextPdf, makeTextPdf } from "../test-support/pdf-fixtures.mjs";

let failures = 0;
function check(label, actual, expected) {
  const pass = actual === expected;
  console.log(`${pass ? "PASS" : "FAIL"} - ${label}`);
  if (!pass) {
    console.log("  expected:", expected);
    console.log("  actual:  ", actual);
    failures += 1;
  }
}
function checkTrue(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"} - ${label}`);
  if (!cond) failures += 1;
}

async function main() {
  // 1. Page boundaries preserved: a 3-page PDF must be attributed to
  // exactly 3 pages, each carrying only ITS OWN content — Page 1's text
  // must not appear on Page 2's `text` and vice versa (Section 34: "Page 1
  // text stays Page 1, Page 2 stays Page 2").
  {
    const page1 = ["COURT OF APPEAL OF TESTLAND", "The Queen v First Appellant", "(1990) 10 XYZ 100"];
    const page2 = ["The appellant was convicted following a trial in the High Court.", "Counsel submitted several grounds of appeal on behalf of the appellant in this matter."];
    const page3 = ["The Court considered each ground in turn before dismissing the appeal entirely."];
    const file = makeMultiPagePdf([page1, page2, page3]);
    const envelope = await runPdfExtractionPipeline(file);
    checkTrue("1. multi-page PDF is extracted", envelope.status === "extracted");
    check("1. pageCount is 3", envelope.pageCount, 3);
    check("1. pages array has 3 entries", envelope.pages.length, 3);
    if (envelope.pages.length === 3) {
      checkTrue("1. page 1 text contains its own content", envelope.pages[0].text.includes("First Appellant"));
      checkTrue("1. page 1 text does NOT contain page 2's content", !envelope.pages[0].text.includes("Counsel submitted"));
      checkTrue("1. page 2 text contains its own content", envelope.pages[1].text.includes("Counsel submitted"));
      checkTrue("1. page 2 text does NOT contain page 1's content", !envelope.pages[1].text.includes("First Appellant"));
      checkTrue("1. page 3 text contains its own content", envelope.pages[2].text.includes("dismissing the appeal"));
      checkTrue("1. page 3 text does NOT contain page 1's content", !envelope.pages[2].text.includes("First Appellant"));
      check("1. page numbers are 1-based and in order", envelope.pages.map((p) => p.pageNumber).join(","), "1,2,3");
    }
    // fullText must still contain every page's content somewhere, with a
    // real separator between pages (never glued page-to-page).
    checkTrue("1. fullText contains page 1 content", envelope.text.includes("First Appellant"));
    checkTrue("1. fullText contains page 2 content", envelope.text.includes("Counsel submitted"));
    checkTrue("1. fullText contains page 3 content", envelope.text.includes("dismissing the appeal"));
  }

  // 2. Metadata extraction prioritizes early pages: the real case header
  // (name + citation + court) is on Page 1; Page 2 contains an unrelated
  // body citation shaped exactly like a header ("Court of Appeal", a case
  // name, a citation) that must NOT outrank the genuine Page 1 header
  // (Section 34: "body citations on later pages don't outrank
  // document-header metadata").
  {
    const page1 = [
      "The Queen v Genuine Appellant",
      "(1995) 44 ABC 200",
      "COURT OF APPEAL OF TESTLAND",
      "This is the actual judgment of the Court in this appeal, delivered after full argument.",
    ];
    const page2 = [
      "The appellant's counsel cited the earlier decision in R v Someone Else",
      "(1980) 5 DEF 60, Court of Appeal, in support of the submissions made on this appeal.",
      "That earlier authority is not the subject of the present appeal but was discussed at length.",
    ];
    const file = makeMultiPagePdf([page1, page2]);
    const envelope = await runPdfExtractionPipeline(file);
    checkTrue("2. two-page PDF is extracted", envelope.status === "extracted" || envelope.status === "low_quality");
    const { fields, caseNameConfidence } = extractCaseLawMetadataWithConfidence(
      envelope.text,
      envelope.pages.map((p) => ({ pageNumber: p.pageNumber, text: p.text })),
    );
    check("2. case name confidence is high (anchored to Page 1's header)", caseNameConfidence, "high");
    checkTrue("2. proposed case name is the Page 1 header, not the Page 2 body citation", (fields.case_name ?? "").includes("Genuine Appellant"));
    checkTrue("2. proposed case name does NOT pick up the Page 2 body citation", !(fields.case_name ?? "").includes("Someone Else"));
  }

  // 3. Word-boundary spacing heuristic: reproduces the live-tested Ramsingh
  // gluing pattern (a page-footer number immediately followed by the next
  // heading with zero separator in the source PDF's Tj calls) — the
  // extracted text must have a space inserted at each lost word boundary,
  // never "138Page" / "72DPP" glued together.
  {
    const file = makeGluedTextPdf();
    const envelope = await runPdfExtractionPipeline(file);
    checkTrue("3. glued-text PDF is usable", envelope.status === "extracted" || envelope.status === "low_quality");
    checkTrue("3. no digit-letter glue at '138Page'", !envelope.text.includes("138Page"));
    checkTrue("3. no digit-letter glue at '72DPP'", !envelope.text.includes("72DPP"));
    checkTrue("3. citation text is still present and intact", envelope.text.includes("(1973) 20 WIR 138"));
    checkTrue("3. the second heading is still present and intact", envelope.text.includes("DPP v Beard"));
  }

  // 4. Backward compatibility: a PDF with ZERO /Type /Page markers (every
  // synthetic fixture from before this pass) must still degrade cleanly
  // to a single implicit page carrying all the text — the page-attribution
  // heuristic must never regress a document with no page markers at all.
  {
    const lines = [
      "The State v Ordinary Appellant",
      "(2001) 1 QRS 1",
      "A single-page judgment with no page markers at all, exactly like every synthetic fixture",
      "used before the page-attribution heuristic was added — this must keep working unchanged.",
      "The appellant was convicted following a trial and now appeals against that conviction.",
      "The Court considered the submissions made by both parties before ruling on the appeal.",
    ];
    const file = makeTextPdf(lines);
    const envelope = await runPdfExtractionPipeline(file);
    checkTrue("4. no-page-marker PDF is usable", envelope.status === "extracted" || envelope.status === "low_quality");
    check("4. degrades to exactly one implicit page", envelope.pageCount, 1);
    if (envelope.pages.length === 1) {
      checkTrue("4. the single page carries all the text", envelope.pages[0].text.includes("Ordinary Appellant"));
      check("4. the single page is numbered 1", envelope.pages[0].pageNumber, 1);
    }
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
