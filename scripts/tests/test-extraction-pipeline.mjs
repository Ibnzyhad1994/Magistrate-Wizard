// Regression tests for src/lib/extraction-pipeline.ts against REAL
// FlateDecode-compressed PDF fixtures (see scripts/test-support/
// pdf-fixtures.mjs) - exercises extractPdfTextLayer -> sanitize ->
// quality gate end to end, the same code path ImportTab calls.
//
// These are synthetic fixtures, not the actual historical PDFs named in
// the governing task - see this pass's final report for why (no PDF
// library/network access to obtain or parse them in this sandbox).
//
// Run with:
//   node --experimental-strip-types --import ./scripts/test-support/register.mjs scripts/tests/test-extraction-pipeline.mjs

import { runPdfExtractionPipeline } from "@/lib/extraction-pipeline";
import {
  makeTextPdf,
  makeConcatenatedTextPdf,
  makeFontBoilerplatePdf,
  makeBinaryGarbagePdf,
  makeImageOnlyPdf,
} from "../test-support/pdf-fixtures.mjs";

const NUL_CHAR = String.fromCharCode(0);

let failures = 0;
async function check(label, actual, expected) {
  const pass = actual === expected;
  console.log(`${pass ? "PASS" : "FAIL"} - ${label}`);
  if (!pass) {
    console.log("  expected:", expected);
    console.log("  actual:  ", actual);
    failures += 1;
  }
}

async function main() {
  // 1. Clean, text-bearing PDF -> status "extracted", text populated.
  {
    const lines = [
      "The State v Dhannie Ramsingh",
      "(1973) 20 WIR 138",
      "COURT OF APPEAL OF GUYANA",
      "The appellant was convicted of manslaughter following a trial in the High Court.",
      "Counsel for the appellant submitted that certain admissions were wrongly admitted",
      "as hearsay evidence and that the trial judge misdirected the jury on this point.",
      "The Court considered the relevant authorities at length before dismissing the appeal.",
    ];
    const file = makeTextPdf(lines);
    const envelope = await runPdfExtractionPipeline(file);
    await check("1. clean PDF status is extracted", envelope.status, "extracted");
    await check("1. clean PDF has non-empty text", envelope.text.length > 0, true);
    await check("1. clean PDF requiresReview is false", envelope.requiresReview, false);
  }

  // 2. Concatenated-but-readable PDF text (no line breaks at all) -- must
  // still be usable (extracted or low_quality), never "failed".
  {
    const text =
      "The appellant appealed against his conviction for manslaughter arguing that the trial judge " +
      "erred in admitting certain out of court statements as evidence against him and further that " +
      "the summing up to the jury was inadequate on the question of provocation raised at trial.";
    const file = makeConcatenatedTextPdf(text);
    const envelope = await runPdfExtractionPipeline(file);
    await check(
      "2. concatenated-but-readable PDF is usable (extracted or low_quality)",
      envelope.status === "extracted" || envelope.status === "low_quality",
      true,
    );
    await check("2. concatenated PDF text is non-empty", envelope.text.length > 0, true);
  }

  // 3. Font/license boilerplate text (real pattern from White v R/The
  // State, Diaz v The State) -- must be rejected, never used as document
  // text, status "failed" (something was extracted, it's just wrong).
  {
    const file = makeFontBoilerplatePdf();
    const envelope = await runPdfExtractionPipeline(file);
    await check("3. font/license boilerplate PDF status is failed", envelope.status, "failed");
    await check("3. font/license boilerplate PDF text withheld", envelope.text, "");
    await check("3. font/license boilerplate PDF requiresReview", envelope.requiresReview, true);
  }

  // 4. Binary/font-garbage extraction with embedded NUL bytes -- the
  // exact scenario that used to reach Supabase and trigger "unsupported
  // Unicode escape sequence". Must never surface raw garbage as text.
  {
    const file = makeBinaryGarbagePdf();
    const envelope = await runPdfExtractionPipeline(file);
    await check(
      "4. binary garbage PDF is not treated as usable text (failed or requires_ocr)",
      envelope.status === "failed" || envelope.status === "requires_ocr",
      true,
    );
    await check("4. binary garbage PDF text withheld", envelope.text, "");
    // Even if some NUL bytes survived into the raw extraction, they must
    // never appear in what the pipeline returns.
    await check("4. no NUL byte in returned text", envelope.text.includes(NUL_CHAR), false);
  }

  // 5. Image-only/scanned PDF -- no text operators at all, must require
  // OCR, must never fabricate a "successful" extraction.
  {
    const file = makeImageOnlyPdf();
    const envelope = await runPdfExtractionPipeline(file);
    await check("5. image-only PDF status is requires_ocr", envelope.status, "requires_ocr");
    await check("5. image-only PDF ocrUsed is false (OCR is not implemented)", envelope.ocrUsed, false);
    await check("5. image-only PDF text withheld", envelope.text, "");
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
