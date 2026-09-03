/**
 * Judgment and bench-note PDF writers return a non-empty PDF buffer.
 *
 *   npm run test:export-pdf
 */
import { generateJudgmentPdf } from "../../src/lib/export/judgment-pdf.ts"
import { generateBenchNotePdf } from "../../src/lib/export/bench-note-pdf.ts"

let failures = 0
function check(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${pass ? "PASS" : "FAIL"} — ${label}`)
  if (!pass) {
    console.log("  expected:", JSON.stringify(expected))
    console.log("  actual:  ", JSON.stringify(actual))
    failures += 1
  }
}

const judgmentDoc = generateJudgmentPdf({
  title: "R v Fixture",
  caseNumber: "GEO-1",
  citation: "[2026] GYMC 1",
  courtName: "Georgetown Magistrates Court",
  judgmentDate: "2026-09-01",
  status: "draft",
  contentText: "The accused is convicted as charged.",
  generatedAtLabel: "3 Sep 2026, 14:00",
})
const judgmentBuf = judgmentDoc.output("arraybuffer")
const judgmentBytes = new Uint8Array(judgmentBuf)
const judgmentHead = String.fromCharCode(...judgmentBytes.slice(0, 4))

check("judgment PDF is a non-empty ArrayBuffer", judgmentBuf.byteLength > 0, true)
check("judgment PDF starts with %PDF", judgmentHead, "%PDF")

const noteDoc = generateBenchNotePdf({
  title: "Hearing notes",
  parentLabel: "GEO-1 · R v Fixture",
  status: "draft",
  contentText: "Witness 1 stood down part-heard.",
  generatedAtLabel: "3 Sep 2026, 14:00",
})
const noteBuf = noteDoc.output("arraybuffer")
const noteBytes = new Uint8Array(noteBuf)
const noteHead = String.fromCharCode(...noteBytes.slice(0, 4))

check("bench-note PDF is a non-empty ArrayBuffer", noteBuf.byteLength > 0, true)
check("bench-note PDF starts with %PDF", noteHead, "%PDF")

const emptyBody = generateJudgmentPdf({
  title: "Empty",
  caseNumber: null,
  citation: null,
  courtName: null,
  judgmentDate: null,
  status: "final",
  contentText: "   ",
  generatedAtLabel: "now",
})
check("empty content_text still yields a PDF", emptyBody.output("arraybuffer").byteLength > 0, true)

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
