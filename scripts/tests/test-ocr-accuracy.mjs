// OCR accuracy + pipeline integration tests.
//
// Run with:
//   node --experimental-strip-types --import ./scripts/test-support/register.mjs scripts/tests/test-ocr-accuracy.mjs

import { characterErrorRate, containsNormalized, wordErrorRate } from "@/lib/ocr/accuracy"
import { postprocessOcrText } from "@/lib/ocr/postprocess"
import { runPdfExtractionPipeline } from "@/lib/extraction-pipeline"
import { makeEncryptedPdf, makeImageOnlyPdf, makeTextPdf } from "../test-support/pdf-fixtures.mjs"
import { makeRenderedScanPdf, SCAN_GROUND_TRUTH, SCAN_MUST_CONTAIN } from "../test-support/scanned-pdf-fixtures.mjs"

let failures = 0
const check = (label, actual, expected) => {
  const pass = actual === expected
  console.log(`${pass ? "PASS" : "FAIL"} - ${label}`)
  if (!pass) {
    console.log("  expected:", expected)
    console.log("  actual:  ", actual)
    failures += 1
  }
}

const checkBelow = (label, actual, max) => {
  const pass = actual <= max
  console.log(`${pass ? "PASS" : "FAIL"} - ${label} (${actual.toFixed(4)} <= ${max})`)
  if (!pass) failures += 1
}

const main = async () => {
  // Unit: postprocess repairs known OCR artifacts without inventing text.
  {
    const raw =
      "THE STATE v DHANNIE RAMSINGH\n( l973 ) 20 WIR 138\nThe appellant was convicted of manslaugh-\nter following a trial."
    const cleaned = postprocessOcrText(raw)
    check("postprocess rejoins hyphenated line-break", cleaned.includes("manslaughter"), true)
    check("postprocess normalizes parenthesized year", cleaned.includes("(1973)"), true)
    check("postprocess does not drop case name", cleaned.includes("DHANNIE RAMSINGH"), true)
  }

  // Text-layer PDF must NOT go through OCR.
  {
    const lines = [
      "The State v Dhannie Ramsingh",
      "(1973) 20 WIR 138",
      "COURT OF APPEAL OF GUYANA",
      "The appellant was convicted of manslaughter following a trial in the High Court.",
      "Counsel for the appellant submitted that certain admissions were wrongly admitted",
      "as hearsay evidence and that the trial judge misdirected the jury on this point.",
      "The Court considered the relevant authorities at length before dismissing the appeal.",
    ]
    const envelope = await runPdfExtractionPipeline(makeTextPdf(lines))
    check("text-layer PDF still extracted without OCR", envelope.status, "extracted")
    check("text-layer PDF ocrUsed is false", envelope.ocrUsed, false)
    check("text-layer PDF method is pdf_text_layer", envelope.method, "pdf_text_layer")
  }

  // Encrypted PDF must never be sent to OCR.
  {
    const envelope = await runPdfExtractionPipeline(makeEncryptedPdf())
    check("encrypted PDF status remains requires_ocr", envelope.status, "requires_ocr")
    check("encrypted PDF ocrUsed is false", envelope.ocrUsed, false)
    check("encrypted PDF unreadableReason is encrypted", envelope.unreadableReason, "encrypted")
    check("encrypted PDF text withheld", envelope.text, "")
  }

  // Malformed image-only fixture (fake JPEG, no page tree): OCR may run and
  // fail, but must never fabricate usable text.
  {
    const envelope = await runPdfExtractionPipeline(makeImageOnlyPdf())
    check("fake image-only PDF status is requires_ocr", envelope.status, "requires_ocr")
    check("fake image-only PDF text withheld", envelope.text, "")
    check(
      "fake image-only PDF unreadableReason is no_text_found",
      envelope.unreadableReason,
      "no_text_found",
    )
  }

  // Real scanned JPEG PDF with known legal ground truth.
  {
    const file = makeRenderedScanPdf()
    const envelope = await runPdfExtractionPipeline(file)
    console.log("scan envelope", {
      status: envelope.status,
      method: envelope.method,
      ocrUsed: envelope.ocrUsed,
      charCount: envelope.charCount,
      requiresReview: envelope.requiresReview,
      warnings: envelope.warnings.slice(0, 3),
    })
    console.log("scan text preview:\n", envelope.text.slice(0, 500))

    check(
      "scanned PDF is usable (extracted or low_quality)",
      envelope.status === "extracted" || envelope.status === "low_quality",
      true,
    )
    check("scanned PDF used OCR", envelope.ocrUsed, true)
    check("scanned PDF method is ocr", envelope.method, "ocr")
    check("scanned PDF always requires review", envelope.requiresReview, true)
    check("scanned PDF text is non-empty", envelope.text.length > 200, true)

    for (const phrase of SCAN_MUST_CONTAIN) {
      check(`scanned PDF contains "${phrase}"`, containsNormalized(envelope.text, phrase), true)
    }

    const cer = characterErrorRate(envelope.text, SCAN_GROUND_TRUTH)
    const wer = wordErrorRate(envelope.text, SCAN_GROUND_TRUTH)
    console.log(`CER=${cer.toFixed(4)} WER=${wer.toFixed(4)}`)
    checkBelow("scanned PDF character error rate", cer, 0.08)
    checkBelow("scanned PDF word error rate", wer, 0.12)
  }

  // Heavier JPEG compression still has to recover the citation and parties.
  {
    const file = makeRenderedScanPdf({ jpegQuality: 55, name: "scanned-compressed.pdf" })
    const envelope = await runPdfExtractionPipeline(file)
    check(
      "compressed scan is usable (extracted or low_quality)",
      envelope.status === "extracted" || envelope.status === "low_quality",
      true,
    )
    check("compressed scan contains case name", containsNormalized(envelope.text, "DHANNIE RAMSINGH"), true)
    check("compressed scan contains citation", containsNormalized(envelope.text, "20 WIR 138"), true)
    const cer = characterErrorRate(envelope.text, SCAN_GROUND_TRUTH)
    console.log(`compressed CER=${cer.toFixed(4)}`)
    checkBelow("compressed scan character error rate", cer, 0.15)
  }

  {
    const file = makeRenderedScanPdf({ jpegQuality: 70, noiseRatio: 0.4, name: "scanned-noisy.pdf" })
    const envelope = await runPdfExtractionPipeline(file)
    check(
      "noisy scan is usable (extracted or low_quality)",
      envelope.status === "extracted" || envelope.status === "low_quality",
      true,
    )
    check("noisy scan contains case name", containsNormalized(envelope.text, "DHANNIE RAMSINGH"), true)
    check("noisy scan contains citation", containsNormalized(envelope.text, "20 WIR 138"), true)
    const cer = characterErrorRate(envelope.text, SCAN_GROUND_TRUTH)
    console.log(`noisy CER=${cer.toFixed(4)}`)
    checkBelow("noisy scan character error rate", cer, 0.12)
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
