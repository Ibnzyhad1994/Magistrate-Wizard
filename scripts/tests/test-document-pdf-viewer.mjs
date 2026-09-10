// Regression: Case Law (and every other DocumentsPanel parent) must
// preview PDFs with the authenticated pdf.js viewer — the same path
// Legislation uses — not Chromium's native plugin inside an iframe of a
// short-lived Storage signed URL. That iframe path shows a lock / blank
// pane for permission-restricted publisher PDFs and for CSP frame-src
// blocks, even when the magistrate can download the file.
//
// Run: node --experimental-strip-types --import ./scripts/test-support/register.mjs scripts/tests/test-document-pdf-viewer.mjs

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "../..")
const viewer = readFileSync(join(root, "src/components/common/document-viewer-dialog.tsx"), "utf8")
const legislationPage = readFileSync(
  join(root, "src/pages/legislation/legislation-viewer-page.tsx"),
  "utf8",
)
const legislationDialog = readFileSync(
  join(root, "src/components/legislation/legislation-pdf-viewer-dialog.tsx"),
  "utf8",
)

let failures = 0
const check = (label, pass) => {
  console.log(`${pass ? "PASS" : "FAIL"} - ${label}`)
  if (!pass) failures += 1
}

check(
  "PDF preview mounts the authenticated pdf.js viewer",
  viewer.includes("LegislationPdfViewer"),
)
check(
  "document PDFs enable redaction",
  /allowRedact/.test(viewer),
)
check(
  "legislation page does not enable redaction",
  !/allowRedact/.test(legislationPage),
)
check(
  "legislation dialog does not enable redaction",
  !/allowRedact/.test(legislationDialog),
)
check(
  "PDF preview does not iframe a signed Storage URL",
  !viewer.includes('<iframe src={url} title={doc.file_name}'),
)
check(
  "PDF preview does not mint a signed URL just to display the file",
  !/fileKind === "pdf"[\s\S]{0,400}getDocumentViewUrl/.test(viewer),
)

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
