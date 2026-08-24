// Ingestion dispatcher + in-app preview helpers: classify by mime/extension,
// gated txt/md/docx envelopes, trusted paste, honest .doc, XSS-safe preview.
//
// Run with:
//   node --experimental-strip-types --import ./scripts/test-support/register.mjs scripts/tests/test-ingest-document.mjs

import JSZip from "jszip"
import { ingestDocument, ingestPastedText } from "@/lib/ingest-document"
import { classifyIngestSource, inferStoredMimeType, assertFileContentMatchesKind } from "@/lib/ingest-source"
import { getDocumentPreviewKind, isLegacyWordDocument } from "@/lib/document-preview"
import { markdownToSafeHtml } from "@/lib/markdown-preview"
import { sanitizePreviewHtml } from "@/lib/html-sanitize"
import { extractDocxText, convertDocxToHtml } from "@/lib/docx-text-extraction"
import { validateFileForUpload } from "@/lib/bulk-ingestion-queue"

const PROSE = [
  "The State v Dhannie Ramsingh",
  "(1973) 20 WIR 138",
  "COURT OF APPEAL OF GUYANA",
  "The appellant was convicted of manslaughter following a trial in the High Court.",
  "Counsel for the appellant submitted that certain admissions were wrongly admitted",
  "as hearsay evidence and that the trial judge misdirected the jury on this point.",
  "The Court considered the relevant authorities at length before dismissing the appeal.",
].join(" ")

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
const checkTrue = (label, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"} - ${label}`)
  if (!cond) failures += 1
}

const makeFile = (name, contents, type = "") => {
  const body = typeof contents === "string" ? contents : contents
  return new File([body], name, type ? { type } : undefined)
}

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

const main = async () => {
  // --- classifyIngestSource ---
  check("classify pdf by mime", classifyIngestSource({ name: "a.bin", type: "application/pdf" }), "pdf")
  check("classify pdf by extension", classifyIngestSource({ name: "Judgment.PDF", type: "" }), "pdf")
  check("classify txt", classifyIngestSource({ name: "notes.txt", type: "text/plain" }), "txt")
  check(
    "classify md with empty mime (extension wins)",
    classifyIngestSource({ name: "judgment.md", type: "" }),
    "markdown",
  )
  check(
    "classify md even when browser reports text/plain",
    classifyIngestSource({ name: "notes.md", type: "text/plain" }),
    "markdown",
  )
  check(
    "classify markdown extension",
    classifyIngestSource({ name: "act.markdown", type: "" }),
    "markdown",
  )
  check(
    "classify docx by mime",
    classifyIngestSource({
      name: "x.bin",
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }),
    "docx",
  )
  check("classify docx by extension not as legacy doc", classifyIngestSource({ name: "Ramsingh.docx", type: "" }), "docx")
  check("classify legacy doc", classifyIngestSource({ name: "old.doc", type: "application/msword" }), "doc")
  check("classify image jpeg", classifyIngestSource({ name: "scan.JPG", type: "" }), "image")
  check("classify unsupported", classifyIngestSource({ name: "virus.exe", type: "application/x-msdownload" }), "unsupported")

  check("infer mime for empty-type md", inferStoredMimeType({ name: "notes.md", type: "" }), "text/markdown")
  check(
    "infer mime for docx",
    inferStoredMimeType({ name: "a.docx", type: "" }),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  )

  // --- paste is trusted (not quality-gated) ---
  {
    const envelope = ingestPastedText("Short pasted note.")
    check("paste short status is extracted", envelope.status, "extracted")
    check("paste method is manual_paste", envelope.method, "manual_paste")
    check("paste requiresReview is false", envelope.requiresReview, false)
    checkTrue("paste keeps the curator text", envelope.text.includes("Short pasted note"))
  }

  // --- txt / markdown quality gate ---
  {
    const envelope = await ingestDocument(makeFile("judgment.txt", PROSE, "text/plain"))
    check("long txt status is extracted", envelope.status, "extracted")
    check("long txt method is txt_file", envelope.method, "txt_file")
    checkTrue("long txt contains case name", envelope.text.includes("Dhannie Ramsingh"))
  }
  {
    const envelope = await ingestDocument(makeFile("short.txt", "Hello.", "text/plain"))
    check("short txt stays pending (quality gate)", envelope.status, "pending")
    check("short txt method is txt_file", envelope.method, "txt_file")
    checkTrue("short txt still keeps the characters for the curator to edit", envelope.text.includes("Hello"))
  }
  {
    const md = `# The State v Dhannie Ramsingh\n\n${PROSE}`
    const envelope = await ingestDocument(makeFile("judgment.md", md, ""))
    check("markdown empty-mime status is extracted", envelope.status, "extracted")
    check("markdown method", envelope.method, "markdown")
    checkTrue("markdown keeps heading source", envelope.text.includes("The State v Dhannie Ramsingh"))
  }

  // --- DOCX via mammoth ---
  {
    const buffer = await makeMinimalDocx(PROSE)
    const text = await extractDocxText(buffer)
    checkTrue("mammoth extracts the judgment prose", text.includes("Dhannie Ramsingh"))
    const file = makeFile(
      "Ramsingh.docx",
      buffer,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
    const envelope = await ingestDocument(file)
    check("docx status is extracted", envelope.status, "extracted")
    check("docx method", envelope.method, "docx")
    checkTrue("docx envelope has the prose", envelope.text.includes("manslaughter"))
    const html = sanitizePreviewHtml(await convertDocxToHtml(buffer))
    checkTrue("docx html preview contains the prose", html.includes("Dhannie"))
    checkTrue("docx html preview has no script tags", !/<script/i.test(html))
  }

  // --- .doc is honest pending, never fabricated ---
  {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    const envelope = await ingestDocument(makeFile("legacy.doc", ole, "application/msword"))
    check("legacy doc status is pending", envelope.status, "pending")
    check("legacy doc method is none", envelope.method, "none")
    check("legacy doc text is empty", envelope.text, "")
    checkTrue("legacy doc warning mentions paste or docx", /docx|paste/i.test(envelope.warnings.join(" ")))
    checkTrue("legacy doc did not invent judgment text", !envelope.text.includes("Ramsingh"))
  }

  // --- preview kinds ---
  check("preview pdf", getDocumentPreviewKind("application/pdf", "a.pdf"), "pdf")
  check("preview image", getDocumentPreviewKind("image/png", "scan.png"), "image")
  check("preview txt", getDocumentPreviewKind("text/plain", "notes.txt"), "text")
  check("preview md by name despite text/plain mime", getDocumentPreviewKind("text/plain", "notes.md"), "markdown")
  check("preview md empty mime", getDocumentPreviewKind("", "act.markdown"), "markdown")
  check("preview docx", getDocumentPreviewKind("", "Ramsingh.docx"), "docx")
  check("preview legacy doc is unsupported", getDocumentPreviewKind("application/msword", "old.doc"), "unsupported")
  checkTrue("isLegacyWordDocument .doc", isLegacyWordDocument("application/msword", "old.doc"))
  checkTrue("isLegacyWordDocument does not treat docx as legacy", !isLegacyWordDocument("", "Ramsingh.docx"))

  // --- XSS ---
  {
    const html = markdownToSafeHtml("Hello <script>alert(1)</script>\n\n[click](javascript:alert(1))\n\n[ok](https://example.com)")
    checkTrue("markdown escapes script tags", html.includes("&lt;script&gt;") && !html.includes("<script>"))
    checkTrue("markdown does not emit javascript: href", !/href\s*=\s*["']?\s*javascript:/i.test(html))
    checkTrue("markdown keeps https links", html.includes('href="https://example.com"'))
  }
  {
    const html = sanitizePreviewHtml(
      '<p>ok</p><script>alert(1)</script><a href="javascript:alert(1)">x</a><img src=x onerror=alert(1)><a href="https://courts.gov">y</a>',
    )
    checkTrue("sanitize strips script", !/<script/i.test(html))
    checkTrue("sanitize drops javascript href", !/javascript:/i.test(html))
    checkTrue("sanitize strips img", !/<img/i.test(html))
    checkTrue("sanitize keeps https anchor", html.includes("https://courts.gov"))
    const svg = sanitizePreviewHtml('<svg/onload=alert(1)>')
    checkTrue("sanitize strips svg shorthand onload", !/<svg/i.test(svg) && !/onload/i.test(svg))
    const aSlash = sanitizePreviewHtml('<a/href="javascript:alert(1)">x</a>')
    checkTrue("sanitize strips a/href javascript shorthand", !/javascript:/i.test(aSlash))
    const entityHref = sanitizePreviewHtml('<a href="j&#97;vascript:alert(1)">x</a>')
    checkTrue("sanitize drops entity-encoded javascript href", !/href\s*=/i.test(entityHref))
  }

  // --- magic-byte upload guard ---
  {
    await assertFileContentMatchesKind(makeFile("ok.pdf", "%PDF-1.4\n%%EOF", "application/pdf"))
    checkTrue("magic accepts %PDF header", true)
    let peRejected = false
    try {
      await assertFileContentMatchesKind(makeFile("evil.pdf", new Uint8Array([0x4d, 0x5a, 0x90, 0x00]), "application/pdf"))
    } catch {
      peRejected = true
    }
    checkTrue("magic rejects PE bytes labeled as pdf", peRejected)
    let htmlAsPdfRejected = false
    try {
      await assertFileContentMatchesKind(makeFile("page.pdf", "<script>alert(1)</script>", "application/pdf"))
    } catch {
      htmlAsPdfRejected = true
    }
    checkTrue("magic rejects HTML labeled as pdf", htmlAsPdfRejected)
    const docxBytes = await makeMinimalDocx("The State v Dhannie Ramsingh")
    await assertFileContentMatchesKind(
      makeFile("Ramsingh.docx", docxBytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    )
    checkTrue("magic accepts zip/docx", true)
    {
      const zip = new JSZip()
      zip.file("inner.pdf", "%PDF-1.4\n%%EOF")
      const buf = await zip.generateAsync({ type: "arraybuffer" })
      let zipAsDocxRejected = false
      try {
        await assertFileContentMatchesKind(
          makeFile("archive.docx", buf, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        )
      } catch {
        zipAsDocxRejected = true
      }
      checkTrue("magic rejects zip without [Content_Types].xml labeled as docx", zipAsDocxRejected)
    }
    await assertFileContentMatchesKind(makeFile("notes.md", PROSE, "text/markdown"))
    checkTrue("magic accepts markdown prose", true)
  }

  // --- upload validator ---
  checkTrue("validator accepts md", validateFileForUpload(makeFile("notes.md", PROSE, "")).ok)
  checkTrue(
    "validator accepts docx",
    validateFileForUpload(
      makeFile("a.docx", new Uint8Array([1, 2, 3]), "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    ).ok,
  )
  checkTrue("validator rejects exe", !validateFileForUpload(makeFile("virus.exe", new Uint8Array([1]), "application/x-msdownload")).ok)

  if (failures > 0) {
    console.error(`\n${failures} failure(s)`)
    process.exit(1)
  }
  console.log("\nAll ingest/preview tests passed.")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
