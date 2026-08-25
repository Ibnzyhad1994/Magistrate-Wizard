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

import { runPdfExtractionPipeline, shouldPreferPdfjsText } from "@/lib/extraction-pipeline";
import { classifyPdfjsOpenError, extractPdfjsTextContent } from "@/lib/ocr/rasterize-pdf";
import {
  makeTextPdf,
  makeConcatenatedTextPdf,
  makeFontBoilerplatePdf,
  makeBinaryGarbagePdf,
  makeImageOnlyPdf,
  makeHexTextPdf,
  makeCompositeFontHexPdf,
  makeEncryptedPdf,
  makeHomemadeShortPdfjsLongPdf,
  makeWellFormedMultiPagePdf,
  makeWellFormedCidToUnicodePdf,
} from "../test-support/pdf-fixtures.mjs";
import { extractPdfTextLayer } from "@/lib/pdf-text-extraction";
import { shouldUseEmbeddedJpegsForOcr } from "@/lib/ocr/run-ocr";
import { interpretDuplicateQuery, DuplicateCheckError } from "@/lib/duplicate-check";
import { isCanonicalCitationUniqueViolation } from "@/lib/utils";

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
    await check("2. concatenated-but-readable PDF is extracted", envelope.status, "extracted");
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
    await check("5. image-only PDF text withheld", envelope.text, "");
    await check("5. image-only PDF unreadableReason is no_text_found", envelope.unreadableReason, "no_text_found");
  }

  // 6. Simple-font PDF using HEX STRING Tj operands (Phase A/D root-cause
  // fix, this pass): no composite/Type0 font marker anywhere in the file,
  // so these hex operands should decode exactly like a literal string and
  // extraction should succeed -- the real defect this pass fixed (real
  // Canadian court PDFs using this encoding were previously reported as
  // "OCR required" because hex operands were never decoded at all).
  {
    const lines = [
      "The State v Test Appellant",
      "(1969) 1 XYZ 525",
      "SUPREME COURT OF TESTLAND",
      "The appellant was convicted following a trial and now appeals against that conviction.",
      "Counsel for the appellant submitted that the trial judge erred in several respects.",
      "The Court considered the relevant authorities at length before dismissing the appeal.",
    ];
    const file = makeHexTextPdf(lines);
    const envelope = await runPdfExtractionPipeline(file);
    await check("6. hex-string simple-font PDF is extracted", envelope.status, "extracted");
    await check("6. hex-string simple-font PDF text is non-empty", envelope.text.length > 0, true);
    await check("6. hex-string simple-font PDF text contains the decoded case name", envelope.text.includes("Test Appellant"), true);
    await check("6. hex-string simple-font PDF unreadableReason is null", envelope.unreadableReason, null);
  }

  // 7. Composite/Type0 (CID-keyed) font PDF using HEX STRING Tj operands
  // (Phase A/D root-cause fix, this pass, false-success guard): the hex
  // operands must be WITHHELD, never decoded as raw character codes --
  // proves the parser distinguishes "hex text I can safely decode" from
  // "hex text that would require a ToUnicode CMap I don't have", honestly
  // reporting unreadableReason "unsupported_font_encoding" instead of
  // fabricating wrong text just because characters could technically be
  // produced.
  {
    const file = makeCompositeFontHexPdf();
    const envelope = await runPdfExtractionPipeline(file);
    await check("7. composite-font hex PDF status is requires_ocr", envelope.status, "requires_ocr");
    await check("7. composite-font hex PDF text withheld", envelope.text, "");
    await check(
      "7. composite-font hex PDF unreadableReason is unsupported_font_encoding",
      envelope.unreadableReason,
      "unsupported_font_encoding",
    );
  }

  // 8. Encrypted PDF (/Encrypt in the trailer, content stream bytes not
  // valid deflate data -- Phase A/D root-cause fix, this pass): must be
  // honestly reported as "encrypted", the most specific and actionable of
  // the three requires_ocr reasons, not lumped in with a genuinely scanned
  // document.
  {
    const file = makeEncryptedPdf();
    const envelope = await runPdfExtractionPipeline(file);
    await check("8. encrypted PDF status is requires_ocr", envelope.status, "requires_ocr");
    await check("8. encrypted PDF text withheld", envelope.text, "");
    await check("8. encrypted PDF unreadableReason is encrypted", envelope.unreadableReason, "encrypted");
  }

  await check("9. pdf.js upgrade helper prefers substantially longer text", shouldPreferPdfjsText(1495, 12497), true);
  await check("9. pdf.js upgrade helper ignores a small difference", shouldPreferPdfjsText(1000, 1100), false);
  await check("9. pdf.js upgrade helper ignores empty pdf.js", shouldPreferPdfjsText(500, 0), false);
  await check("9. embedded JPEGs used only when rasterize failed", shouldUseEmbeddedJpegsForOcr(0, 3), true);
  await check("9. embedded JPEGs not preferred when pages were rasterized", shouldUseEmbeddedJpegsForOcr(5, 3), false);

  {
    const file = makeHomemadeShortPdfjsLongPdf();
    const homemade = await extractPdfTextLayer(file);
    const envelope = await runPdfExtractionPipeline(file);
    await check("9. multi-stream homemade is shorter than pipeline text", homemade.text.length < envelope.text.length, true);
    await check(
      "9. multi-stream fixture recovers later-page unique text",
      envelope.text.includes("Later page paragraph 12"),
      true,
    );
    await check("9. multi-stream status is extracted", envelope.status, "extracted");
  }

  {
    const pages = [];
    const nonce = (n) => {
      const letters = "abcdefghijkmnopqrstuvwxyz"
      let s = "zx"
      let x = n + 11
      while (x > 0) {
        s += letters[x % letters.length]
        x = Math.floor(x / letters.length)
      }
      return s
    }
    for (let i = 1; i <= 45; i++) {
      pages.push([
        `In the matter of ${nonce(i)} the appellant ${nonce(i + 17)} challenged a conviction recorded against ${nonce(i + 23)}.`,
        `Submissions for ${nonce(i + 50)} addressed hearsay involving ${nonce(i + 61)} and whether ${nonce(i + 73)} fairly put the defence of ${nonce(i + 81)}.`,
        i === 45
          ? "PAGE_FORTYFIVE_UNIQUE_MARKER the Court dismissed the appeal after considering the summing up."
          : `The court in ${nonce(i + 90)} recorded that identification by ${nonce(i + 101)} cannot rest on ${nonce(i + 113)} alone.`,
      ]);
    }
    const file = makeWellFormedMultiPagePdf(pages, "forty-five-pages.pdf");
    const envelope = await runPdfExtractionPipeline(file);
    await check("10. 45-page born-digital status is extracted", envelope.status, "extracted");
    await check("10. 45-page envelope includes page 45", envelope.pages.some((p) => p.pageNumber === 45), true);
    await check("10. 45-page text includes last-page marker", envelope.text.includes("PAGE_FORTYFIVE_UNIQUE_MARKER"), true);
    await check("10. 45-page has no truncation warning", envelope.warnings.some((w) => /only the first/i.test(w)), false);
  }

  {
    const recovered = await extractPdfjsTextContent(makeWellFormedMultiPagePdf([["Cap page one."], ["Cap page two."]]), {
      maxPages: 1,
    });
    await check("10b. optional text cap reports truncated", recovered.ok && recovered.truncated, true);
    await check("10b. optional text cap warns", recovered.ok && recovered.warnings.some((w) => /only the first 1 of 2 pages/i.test(w)), true);
  }

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
    const file = makeWellFormedCidToUnicodePdf(lines);
    const homemade = await extractPdfTextLayer(file);
    const envelope = await runPdfExtractionPipeline(file);
    await check("11. CID homemade does not decode Type0 hex as success", homemade.hasTextLayer, false);
    await check("11. CID pdf.js-primary status is extracted", envelope.status, "extracted");
    await check("11. CID pdf.js-primary contains case name", envelope.text.includes("Dhannie Ramsingh"), true);
  }

  await check(
    "12. PasswordException is need_password",
    classifyPdfjsOpenError({ name: "PasswordException", code: 1 }),
    "need_password",
  );
  await check("12. TimeoutError is timeout", classifyPdfjsOpenError({ name: "TimeoutError" }), "timeout");
  await check("12. AbortError is aborted", classifyPdfjsOpenError({ name: "AbortError" }), "aborted");

  {
    let threw = false;
    try {
      interpretDuplicateQuery({ data: null, error: { message: "fetch failed" } }, (row) => row);
    } catch (e) {
      threw = e instanceof DuplicateCheckError;
    }
    await check("13. duplicate query error throws DuplicateCheckError", threw, true);
    const hit = interpretDuplicateQuery(
      { data: [{ id: "a", case_name: "X", citation: "1" }], error: null },
      (row) => ({ id: row.id, label: `${row.case_name} (${row.citation})` }),
    );
    await check("13. duplicate query hit maps the row", hit?.id, "a");
    await check(
      "13. duplicate query miss is null",
      interpretDuplicateQuery({ data: [], error: null }, (row) => ({ id: row.id, label: "x" })),
      null,
    );
  }

  await check(
    "13. citation unique violation uses code+constraint",
    isCanonicalCitationUniqueViolation({
      code: "23505",
      message: 'duplicate key value violates unique constraint "case_law_citation_canonical_unique_idx"',
    }),
    true,
  );
  await check(
    "13. mapped English message is not enough without 23505",
    isCanonicalCitationUniqueViolation({
      message: "A canonical case with this citation already exists.",
    }),
    false,
  );

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
