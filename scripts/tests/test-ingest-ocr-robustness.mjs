// Full-scale ingest + OCR robustness / accuracy audit.
// Every supported file type is ingested through ingestDocument() against
// a known original (GOLDEN). Encoded vs non-encoded PDFs are compared
// to the same ground truth. OCR paths are scored with CER/WER.
//
// Run:
//   node --experimental-strip-types --import ./scripts/test-support/register.mjs scripts/tests/test-ingest-ocr-robustness.mjs

import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import JSZip from "jszip"
import { ingestDocument, ingestPastedText, classifyIngestSource } from "@/lib/ingest-document"
import { extractPdfTextLayer } from "@/lib/pdf-text-extraction"
import { characterErrorRate, containsNormalized, wordErrorRate } from "@/lib/ocr/accuracy"
import {
  makeTextPdf,
  makeUncompressedTextPdf,
  makeHexTextPdf,
  makeMixedEncodingPdf,
  makeTjArrayPdf,
  makeTjJudgmentPdf,
  makeMultiPagePdf,
  makeConcatenatedTextPdf,
  makeEncryptedPdf,
  makeCompositeFontHexPdf,
  makeCmapPollutedPdf,
  makeFontBoilerplatePdf,
  makeImageOnlyPdf,
} from "../test-support/pdf-fixtures.mjs"
import {
  SCAN_GROUND_TRUTH,
  SCAN_MUST_CONTAIN,
  makeRenderedScanPdf,
  renderLegalScanJpeg,
  renderLegalScanPng,
  renderLegalScanWebp,
} from "../test-support/scanned-pdf-fixtures.mjs"

const GOLDEN_LINES = [
  "IN THE COURT OF APPEAL OF GUYANA",
  "Criminal Appeal No. 12 of 1973",
  "THE STATE v DHANNIE RAMSINGH",
  "(1973) 20 WIR 138",
  "The appellant was convicted of manslaughter following a trial in the High Court.",
  "Counsel for the appellant submitted that certain admissions were wrongly admitted",
  "as hearsay evidence and that the trial judge misdirected the jury on this point.",
  "The Court considered the relevant authorities at length before dismissing the appeal.",
  "Held, that the summing up was adequate and the conviction is affirmed.",
]

const GOLDEN = GOLDEN_LINES.join("\n")
const GOLDEN_PROSE = GOLDEN_LINES.join(" ")

const MUST = SCAN_MUST_CONTAIN

const results = []
let failures = 0

const record = (row) => {
  results.push(row)
  const mark = row.pass ? "PASS" : "FAIL"
  const extra = [
    row.status ? `status=${row.status}` : null,
    row.method ? `method=${row.method}` : null,
    row.ocrUsed != null ? `ocr=${row.ocrUsed}` : null,
    row.cer != null ? `CER=${Number(row.cer).toFixed(4)}` : null,
    row.wer != null ? `WER=${Number(row.wer).toFixed(4)}` : null,
  ]
    .filter(Boolean)
    .join("  ")
  console.log(`${mark}  [${row.family}] ${row.label}${extra ? `  (${extra})` : ""}`)
  if (!row.pass) {
    failures += 1
    if (row.detail) console.log("       ", row.detail)
    if (row.preview) console.log("        preview:", String(row.preview).slice(0, 220))
  }
}

const usable = (envelope) => envelope.status === "extracted" || envelope.status === "low_quality"

const scoreAgainst = (text, truth) => ({
  cer: characterErrorRate(text, truth),
  wer: wordErrorRate(text, truth),
  hits: MUST.map((p) => ({ phrase: p, ok: containsNormalized(text, p) })),
})

const makeFile = (name, contents, type = "") =>
  new File([contents], name, type ? { type } : undefined)

const makeMinimalDocx = async (paragraphText) => {
  const zip = new JSZip()
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  )
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  )
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t xml:space="preserve">${paragraphText}</w:t></w:r></w:p>
  </w:body>
</w:document>`,
  )
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`,
  )
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" })
}

const assertExactish = ({ family, label, envelope, truth, maxCer, expectMethod, expectOcr }) => {
  const scores = scoreAgainst(envelope.text, truth)
  const missing = scores.hits.filter((h) => !h.ok).map((h) => h.phrase)
  const pass =
    usable(envelope) &&
    scores.cer <= maxCer &&
    missing.length === 0 &&
    (expectMethod ? envelope.method === expectMethod : true) &&
    (expectOcr == null ? true : envelope.ocrUsed === expectOcr)
  record({
    family,
    label,
    pass,
    status: envelope.status,
    method: envelope.method,
    ocrUsed: envelope.ocrUsed,
    unreadableReason: envelope.unreadableReason,
    charCount: envelope.charCount,
    qualityScore: envelope.qualityScore,
    cer: scores.cer,
    wer: scores.wer,
    maxCer,
    missing,
    preview: envelope.text.slice(0, 180),
    detail: !pass
      ? [
          !usable(envelope) ? `not usable (${envelope.status})` : null,
          scores.cer > maxCer ? `CER ${scores.cer.toFixed(4)} > ${maxCer}` : null,
          missing.length ? `missing: ${missing.join(" | ")}` : null,
          expectMethod && envelope.method !== expectMethod ? `method ${envelope.method} != ${expectMethod}` : null,
          expectOcr != null && envelope.ocrUsed !== expectOcr ? `ocrUsed ${envelope.ocrUsed} != ${expectOcr}` : null,
          envelope.warnings?.[0],
        ]
          .filter(Boolean)
          .join("; ")
      : null,
  })
}

const assertWithheld = ({ family, label, envelope, expectReason, expectOcr = false }) => {
  const fabricated = MUST.some((p) => containsNormalized(envelope.text, p))
  const pass =
    !usable(envelope) &&
    envelope.text === "" &&
    !fabricated &&
    (expectReason ? envelope.unreadableReason === expectReason : true) &&
    envelope.ocrUsed === expectOcr
  record({
    family,
    label,
    pass,
    status: envelope.status,
    method: envelope.method,
    ocrUsed: envelope.ocrUsed,
    unreadableReason: envelope.unreadableReason,
    charCount: envelope.charCount,
    cer: null,
    wer: null,
    preview: envelope.warnings?.join(" | ").slice(0, 220),
    detail: !pass
      ? `status=${envelope.status} textLen=${envelope.text.length} reason=${envelope.unreadableReason} ocr=${envelope.ocrUsed}`
      : null,
  })
}

const main = async () => {
  // ------------------------------------------------------------------
  // 1. Classification of every accepted type
  // ------------------------------------------------------------------
  const classifications = [
    ["judgment.pdf", "application/pdf", "pdf"],
    ["notes.TXT", "", "txt"],
    ["act.md", "", "markdown"],
    ["act.markdown", "text/plain", "markdown"],
    ["Ramsingh.docx", "", "docx"],
    ["legacy.doc", "application/msword", "doc"],
    ["scan.png", "", "image"],
    ["scan.JPG", "", "image"],
    ["scan.webp", "image/webp", "image"],
    ["virus.exe", "", "unsupported"],
  ]
  for (const [name, type, expected] of classifications) {
    const actual = classifyIngestSource({ name, type })
    record({
      family: "classify",
      label: `${name} → ${expected}`,
      pass: actual === expected,
      status: actual,
      detail: actual !== expected ? `got ${actual}` : null,
    })
  }

  // ------------------------------------------------------------------
  // 2. Born-digital exact text (known original, no OCR)
  // ------------------------------------------------------------------
  {
    const envelope = ingestPastedText(GOLDEN)
    assertExactish({
      family: "born-digital",
      label: "pasted text (known original)",
      envelope,
      truth: GOLDEN,
      maxCer: 0.01,
      expectMethod: "manual_paste",
      expectOcr: false,
    })
  }
  {
    const envelope = await ingestDocument(makeFile("judgment.txt", GOLDEN, "text/plain"))
    assertExactish({
      family: "born-digital",
      label: ".txt file",
      envelope,
      truth: GOLDEN,
      maxCer: 0.01,
      expectMethod: "txt_file",
      expectOcr: false,
    })
  }
  {
    const md = `# ${GOLDEN_LINES[2]}\n\n${GOLDEN_PROSE}`
    const envelope = await ingestDocument(makeFile("judgment.md", md, ""))
    assertExactish({
      family: "born-digital",
      label: ".md file (empty mime)",
      envelope,
      truth: GOLDEN,
      maxCer: 0.08,
      expectMethod: "markdown",
      expectOcr: false,
    })
  }
  {
    const accented =
      "IN THE COURT OF APPEAL OF GUYANA. " +
      "The naïve witness gave café testimony regarding the résumé of the appellant. " +
      "Counsel submitted that certain admissions were wrongly admitted as hearsay evidence. " +
      "The Court considered the relevant authorities at length before dismissing the appeal."
    const envelope = await ingestDocument(makeFile("accents.txt", accented, "text/plain"))
    const hasAccents =
      envelope.text.includes("naïve") && envelope.text.includes("café") && envelope.text.includes("résumé")
    record({
      family: "born-digital",
      label: ".txt Latin-1 accents preserved",
      pass: usable(envelope) && hasAccents,
      status: envelope.status,
      method: envelope.method,
      ocrUsed: false,
      preview: envelope.text.slice(0, 160),
      detail: hasAccents ? null : "lost naïve/café/résumé",
    })
  }
  {
    const buffer = await makeMinimalDocx(GOLDEN_PROSE)
    const envelope = await ingestDocument(
      makeFile(
        "Ramsingh.docx",
        buffer,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    )
    assertExactish({
      family: "born-digital",
      label: ".docx (Word OOXML)",
      envelope,
      truth: GOLDEN_PROSE,
      maxCer: 0.02,
      expectMethod: "docx",
      expectOcr: false,
    })
  }
  {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...new Array(200).fill(0)])
    const envelope = await ingestDocument(makeFile("legacy.doc", ole, "application/msword"))
    record({
      family: "honesty",
      label: "legacy .doc never fabricates text",
      pass: envelope.status === "pending" && envelope.text === "" && /docx|paste/i.test(envelope.warnings.join(" ")),
      status: envelope.status,
      method: envelope.method,
      ocrUsed: envelope.ocrUsed,
      preview: envelope.warnings.join(" | "),
    })
  }

  // ------------------------------------------------------------------
  // 3. PDF encodings — known original, text-layer (no OCR)
  // ------------------------------------------------------------------
  {
    const file = makeTextPdf(GOLDEN_LINES, "literal-flate.pdf")
    const layer = await extractPdfTextLayer(file)
    record({
      family: "pdf-encoding",
      label: "literal FlateDecode: lightweight parser finds text layer",
      pass: layer.hasTextLayer === true && layer.requiresOcr === false,
      status: layer.hasTextLayer ? "text_layer" : layer.unreadableReason,
    })
    const envelope = await ingestDocument(file)
    assertExactish({
      family: "pdf-encoding",
      label: "literal (non-encoded) FlateDecode PDF",
      envelope,
      truth: GOLDEN,
      maxCer: 0.04,
      expectMethod: "pdf_text_layer",
      expectOcr: false,
    })
  }
  {
    const file = makeUncompressedTextPdf(GOLDEN_LINES, "uncompressed-literal.pdf")
    const layer = await extractPdfTextLayer(file)
    record({
      family: "pdf-encoding",
      label: "uncompressed stream: lightweight parser finds text layer",
      pass: layer.hasTextLayer === true,
      status: layer.hasTextLayer ? "text_layer" : layer.unreadableReason,
    })
    const envelope = await ingestDocument(file)
    assertExactish({
      family: "pdf-encoding",
      label: "uncompressed (no /Filter) literal PDF",
      envelope,
      truth: GOLDEN,
      maxCer: 0.04,
      expectMethod: "pdf_text_layer",
      expectOcr: false,
    })
  }
  {
    const file = makeHexTextPdf(GOLDEN_LINES, "simple-hex.pdf")
    const layer = await extractPdfTextLayer(file)
    record({
      family: "pdf-encoding",
      label: "SIMPLE-font hex encoding: parser decodes (not OCR)",
      pass: layer.hasTextLayer === true && layer.unreadableReason === null,
      status: layer.hasTextLayer ? "text_layer" : layer.unreadableReason,
    })
    const envelope = await ingestDocument(file)
    assertExactish({
      family: "pdf-encoding",
      label: "encoded SIMPLE-font hex-string PDF",
      envelope,
      truth: GOLDEN,
      maxCer: 0.04,
      expectMethod: "pdf_text_layer",
      expectOcr: false,
    })
  }
  {
    const file = makeMixedEncodingPdf(GOLDEN_LINES.slice(0, 4), GOLDEN_LINES.slice(4), "mixed-encoding.pdf")
    const envelope = await ingestDocument(file)
    assertExactish({
      family: "pdf-encoding",
      label: "mixed literal + hex in one stream",
      envelope,
      truth: GOLDEN,
      maxCer: 0.06,
      expectMethod: "pdf_text_layer",
      expectOcr: false,
    })
  }
  {
    const shortLayer = await extractPdfTextLayer(makeTjArrayPdf())
    record({
      family: "pdf-encoding",
      label: "short TJ array is below confidence floor (honest withhold, not a false success)",
      pass: shortLayer.hasTextLayer === false && shortLayer.requiresOcr === true,
      status: shortLayer.unreadableReason,
    })
    const file = makeTjJudgmentPdf(GOLDEN_LINES, "tj-judgment.pdf")
    const layer = await extractPdfTextLayer(file)
    record({
      family: "pdf-encoding",
      label: "long TJ array text-layer contains judgment words",
      pass:
        containsNormalized(layer.text, "Hello") === false &&
        containsNormalized(layer.text, "DHANNIE RAMSINGH") &&
        containsNormalized(layer.text, "manslaughter"),
      preview: layer.text.slice(0, 180),
    })
    const envelope = await ingestDocument(file)
    assertExactish({
      family: "pdf-encoding",
      label: "TJ kerning-array PDF (encoded word gaps) vs known original",
      envelope,
      truth: GOLDEN_PROSE,
      maxCer: 0.08,
      expectMethod: "pdf_text_layer",
      expectOcr: false,
    })
  }
  {
    const pages = [GOLDEN_LINES.slice(0, 4), GOLDEN_LINES.slice(4)]
    const file = makeMultiPagePdf(pages, "multi-page-literal.pdf")
    const envelope = await ingestDocument(file)
    assertExactish({
      family: "pdf-encoding",
      label: "multi-page literal PDF (page attribution)",
      envelope,
      truth: GOLDEN,
      maxCer: 0.06,
      expectMethod: "pdf_text_layer",
      expectOcr: false,
    })
    record({
      family: "pdf-encoding",
      label: "multi-page PDF reports pageCount >= 2",
      pass: envelope.pageCount >= 2,
      status: String(envelope.pageCount),
    })
  }
  {
    const envelope = await ingestDocument(makeConcatenatedTextPdf(GOLDEN_PROSE, "concatenated.pdf"))
    assertExactish({
      family: "pdf-encoding",
      label: "concatenated single-Tj PDF",
      envelope,
      truth: GOLDEN_PROSE,
      maxCer: 0.04,
      expectMethod: "pdf_text_layer",
      expectOcr: false,
    })
  }

  // ------------------------------------------------------------------
  // 4. Honesty: encoded CID, encrypted, garbage, CMap, boilerplate
  // ------------------------------------------------------------------
  {
    const file = makeCompositeFontHexPdf()
    const layer = await extractPdfTextLayer(file)
    record({
      family: "honesty",
      label: "CID/Type0 hex: lightweight parser refuses (unsupported_font_encoding)",
      pass: layer.hasTextLayer === false && layer.unreadableReason === "unsupported_font_encoding",
      status: layer.unreadableReason,
    })
    const envelope = await ingestDocument(file)
    const fabricated =
      envelope.ocrUsed === false &&
      envelope.method === "pdf_text_layer" &&
      containsNormalized(envelope.text, "CID-encoded under a composite")
    record({
      family: "honesty",
      label: "CID/Type0: lightweight parser must not silently decode as Latin-1",
      pass: !fabricated,
      status: envelope.status,
      method: envelope.method,
      ocrUsed: envelope.ocrUsed,
      unreadableReason: envelope.unreadableReason,
      preview: envelope.text.slice(0, 160),
      detail: fabricated ? "lightweight parser decoded CID hex as characters" : null,
    })
  }
  {
    const envelope = await ingestDocument(makeEncryptedPdf())
    assertWithheld({
      family: "honesty",
      label: "encrypted PDF never sent to OCR, text withheld",
      envelope,
      expectReason: "encrypted",
      expectOcr: false,
    })
  }
  {
    const envelope = await ingestDocument(makeFontBoilerplatePdf())
    const leaked = /SIL Open Font License|Reserved Font Name/i.test(envelope.text)
    record({
      family: "honesty",
      label: "font-license boilerplate is not treated as judgment text",
      pass: !usable(envelope) || !leaked,
      status: envelope.status,
      method: envelope.method,
      preview: envelope.text.slice(0, 160),
    })
  }
  {
    const envelope = await ingestDocument(makeCmapPollutedPdf())
    const cmapLeak = /AdobeUCS2|begincmap/i.test(envelope.text)
    const hasJudgment = containsNormalized(envelope.text, "The State v Test Appellant")
    record({
      family: "honesty",
      label: "ToUnicode CMap must not leak; real judgment text kept",
      pass: usable(envelope) && hasJudgment && !cmapLeak,
      status: envelope.status,
      method: envelope.method,
      ocrUsed: envelope.ocrUsed,
      preview: envelope.text.slice(0, 180),
      detail: cmapLeak ? "CMap leak" : !hasJudgment ? "lost judgment text" : null,
    })
  }
  {
    const envelope = await ingestDocument(makeImageOnlyPdf())
    record({
      family: "honesty",
      label: "malformed image-only PDF withholds (no fabricated judgment)",
      pass: !usable(envelope) && envelope.text === "" && !MUST.some((p) => containsNormalized(envelope.text, p)),
      status: envelope.status,
      method: envelope.method,
      ocrUsed: envelope.ocrUsed,
      unreadableReason: envelope.unreadableReason,
      preview: envelope.warnings.join(" | ").slice(0, 200),
    })
  }
  {
    const envelope = await ingestDocument(makeFile("virus.exe", new Uint8Array([0x4d, 0x5a]), "application/x-msdownload"))
    record({
      family: "honesty",
      label: "unsupported .exe does not invent text",
      pass: envelope.text === "" && envelope.status === "pending",
      status: envelope.status,
      preview: envelope.warnings.join(" | "),
    })
  }
  {
    const envelope = await ingestDocument(makeFile("empty.txt", "", "text/plain"))
    record({
      family: "honesty",
      label: "empty .txt stays pending, no invented prose",
      pass: envelope.text === "" && envelope.status === "pending" && envelope.method === "txt_file",
      status: envelope.status,
      method: envelope.method,
    })
  }

  // ------------------------------------------------------------------
  // 5. OCR — scanned PDFs and every image type, known original
  // ------------------------------------------------------------------
  {
    const file = makeRenderedScanPdf({ jpegQuality: 92, name: "scan-hq.pdf" })
    const envelope = await ingestDocument(file)
    assertExactish({
      family: "ocr",
      label: "scanned JPEG PDF (high quality, known original)",
      envelope,
      truth: SCAN_GROUND_TRUTH,
      maxCer: 0.08,
      expectMethod: "ocr",
      expectOcr: true,
    })
    record({
      family: "ocr",
      label: "scanned PDF always requires curator review",
      pass: envelope.requiresReview === true,
      status: envelope.status,
    })
  }
  {
    const file = makeRenderedScanPdf({ jpegQuality: 55, name: "scan-compressed.pdf" })
    const envelope = await ingestDocument(file)
    assertExactish({
      family: "ocr",
      label: "heavily compressed scanned PDF (q=55)",
      envelope,
      truth: SCAN_GROUND_TRUTH,
      maxCer: 0.15,
      expectOcr: true,
    })
  }
  {
    const file = makeRenderedScanPdf({ jpegQuality: 70, noiseRatio: 0.35, name: "scan-noisy.pdf" })
    const envelope = await ingestDocument(file)
    const scores = scoreAgainst(envelope.text, SCAN_GROUND_TRUTH)
    const hasName = containsNormalized(envelope.text, "DHANNIE RAMSINGH")
    const hasCite = containsNormalized(envelope.text, "WIR 138")
    record({
      family: "ocr",
      label: "noisy scanned PDF still recovers case name + reporter/page",
      pass: usable(envelope) && hasName && hasCite && scores.cer <= 0.18,
      status: envelope.status,
      method: envelope.method,
      ocrUsed: envelope.ocrUsed,
      cer: scores.cer,
      wer: scores.wer,
      preview: envelope.text.slice(0, 200),
    })
  }
  {
    const { jpeg } = renderLegalScanJpeg(SCAN_GROUND_TRUTH, 92, 0)
    const envelope = await ingestDocument(makeFile("scan.jpg", jpeg, "image/jpeg"))
    assertExactish({
      family: "ocr",
      label: "JPEG image ingest",
      envelope,
      truth: SCAN_GROUND_TRUTH,
      maxCer: 0.1,
      expectMethod: "ocr",
      expectOcr: true,
    })
  }
  {
    const { png } = renderLegalScanPng(SCAN_GROUND_TRUTH, 42)
    const envelope = await ingestDocument(makeFile("scan.png", png, "image/png"))
    assertExactish({
      family: "ocr",
      label: "PNG image ingest",
      envelope,
      truth: SCAN_GROUND_TRUTH,
      maxCer: 0.1,
      expectMethod: "ocr",
      expectOcr: true,
    })
  }
  {
    const { png } = renderLegalScanPng(SCAN_GROUND_TRUTH, 22)
    const envelope = await ingestDocument(makeFile("scan-small-type.png", png, "image/png"))
    const scores = scoreAgainst(envelope.text, SCAN_GROUND_TRUTH)
    const hasCite = containsNormalized(envelope.text, "20 WIR 138")
    const hasName = containsNormalized(envelope.text, "RAMSINGH")
    record({
      family: "ocr",
      label: "small-type PNG (22px @ 300dpi) recovers name + citation",
      pass: usable(envelope) && hasCite && hasName && scores.cer <= 0.22,
      status: envelope.status,
      method: envelope.method,
      ocrUsed: envelope.ocrUsed,
      cer: scores.cer,
      wer: scores.wer,
      preview: envelope.text.slice(0, 200),
    })
  }
  {
    const webp = renderLegalScanWebp(SCAN_GROUND_TRUTH)
    if (!webp.supported || !webp.webp) {
      record({
        family: "ocr",
        label: "WebP image ingest (encoder unavailable in this environment)",
        pass: true,
        status: "skipped",
        detail: "napi-rs/canvas could not encode WebP; classification still covered above",
      })
    } else {
      const envelope = await ingestDocument(makeFile("scan.webp", webp.webp, "image/webp"))
      assertExactish({
        family: "ocr",
        label: "WebP image ingest",
        envelope,
        truth: SCAN_GROUND_TRUTH,
        maxCer: 0.12,
        expectMethod: "ocr",
        expectOcr: true,
      })
    }
  }

  // ------------------------------------------------------------------
  // Write machine-readable results for the audit canvas
  // ------------------------------------------------------------------
  const outPath = join(dirname(fileURLToPath(import.meta.url)), "ingest-ocr-robustness-results.json")
  const summary = {
    generatedAt: new Date().toISOString(),
    golden: GOLDEN,
    total: results.length,
    passed: results.filter((r) => r.pass).length,
    failed: results.filter((r) => !r.pass).length,
    families: Object.fromEntries(
      [...new Set(results.map((r) => r.family))].map((family) => {
        const rows = results.filter((r) => r.family === family)
        return [
          family,
          {
            total: rows.length,
            passed: rows.filter((r) => r.pass).length,
            failed: rows.filter((r) => !r.pass).length,
          },
        ]
      }),
    ),
    results,
  }
  writeFileSync(outPath, JSON.stringify(summary, null, 2))
  console.log(`\nWrote ${outPath}`)
  console.log(failures === 0 ? `\nALL ${results.length} CHECKS PASS` : `\n${failures} FAILURE(S) of ${results.length}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
