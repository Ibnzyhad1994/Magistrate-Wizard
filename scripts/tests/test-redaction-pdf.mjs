/**
 * Redaction geometry plus burned-PDF export.
 *
 *   npm run test:redaction-pdf
 */
import jsPDF from "jspdf"
import {
  clampRedactionBox,
  normalizedToPixelRect,
  pixelRectToNormalized,
  undoRedaction,
} from "../../src/lib/redaction.ts"
import { burnRedactedPdf } from "../../src/lib/redaction-pdf.ts"

const PdfCtor = typeof jsPDF === "function" ? jsPDF : jsPDF.jsPDF

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

const page = { width: 200, height: 100 }
const box = pixelRectToNormalized({ x: 20, y: 10, width: 40, height: 20 }, page, 1)
check("pixel to normalized x", box.x, 0.1)
check("pixel to normalized y", box.y, 0.1)
check("pixel to normalized width", box.width, 0.2)
check("pixel to normalized height", box.height, 0.2)

const back = normalizedToPixelRect(box, page)
check("round-trip x", back.x, 20)
check("round-trip y", back.y, 10)
check("round-trip width", back.width, 40)
check("round-trip height", back.height, 20)

const draggedUpLeft = pixelRectToNormalized({ x: 50, y: 40, width: -30, height: -20 }, page, 2)
check("negative drag origin x", draggedUpLeft.x, 0.1)
check("negative drag origin y", draggedUpLeft.y, 0.2)
check("negative drag width", draggedUpLeft.width, 0.15)
check("negative drag height", draggedUpLeft.height, 0.2)

const clamped = clampRedactionBox({ pageNumber: 1, x: -0.2, y: 0.9, width: 2, height: 0.5 })
check("clamp x", clamped.x, 0)
check("clamp y", clamped.y, 0.9)
check("clamp width to page", clamped.width, 1)
check("clamp height to remaining", Math.abs(clamped.height - 0.1) < 1e-10, true)

check("undo last box", undoRedaction([{ pageNumber: 1, x: 0, y: 0, width: 1, height: 1 }]).length, 0)

const fixture = new PdfCtor({ unit: "pt", format: "a4" })
fixture.setFont("helvetica", "normal")
fixture.setFontSize(18)
fixture.text("SECRET123", 72, 120)
const fixtureBuf = fixture.output("arraybuffer")
const fixtureBytes = new Uint8Array(fixtureBuf)
const originalCopy = fixtureBytes.slice()

const burned = await burnRedactedPdf({
  bytes: fixtureBytes,
  boxes: [{ pageNumber: 1, x: 0, y: 0, width: 1, height: 1 }],
  title: "fixture.pdf",
})
const burnedHead = String.fromCharCode(...burned.slice(0, 4))
check("burned PDF is non-empty", burned.byteLength > 0, true)
check("burned PDF starts with %PDF", burnedHead, "%PDF")
check(
  "original bytes unchanged",
  originalCopy.length === fixtureBytes.length && originalCopy.every((b, i) => b === fixtureBytes[i]),
  true,
)

const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
const loaded = await pdfjs.getDocument({ data: burned, verbosity: 0 }).promise
const page1 = await loaded.getPage(1)
const text = await page1.getTextContent()
const joined = text.items.map((item) => (item && typeof item.str === "string" ? item.str : "")).join("")
check("burned PDF has no SECRET123 text layer", joined.includes("SECRET123"), false)
await loaded.destroy?.()
await loaded.cleanup?.()

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
