/**
 * Redaction geometry plus burned-PDF export.
 *
 *   npm run test:redaction-pdf
 */
import jsPDF from "jspdf"
import {
  clampRedactionBox,
  normalizedToPixelRect,
  pageBoxEntries,
  pixelRectToNormalized,
  removeRedactionBoxAt,
  undoRedaction,
} from "../../src/lib/redaction.ts"
import { isRateLimitedError } from "../../src/lib/utils.ts"
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

// --- removing one box, not just the last ------------------------------------
// Undo alone made correcting an earlier box cost every good box drawn after
// it, which on a legal document pushes people toward redrawing rather than
// fixing a rectangle that may be leaking text.

const b = (pageNumber, x) => ({ pageNumber, x, y: 0, width: 0.1, height: 0.1 })
const many = [b(1, 0.1), b(2, 0.2), b(1, 0.3), b(3, 0.4)]

check(
  "removing the middle box keeps the ones drawn after it",
  removeRedactionBoxAt(many, 1).map((x) => x.x),
  [0.1, 0.3, 0.4],
)
check("removing the first box", removeRedactionBoxAt(many, 0).map((x) => x.x), [0.2, 0.3, 0.4])
check("removing the last box", removeRedactionBoxAt(many, 3).map((x) => x.x), [0.1, 0.2, 0.3])
check("the original array is not mutated", many.length, 4)

// A click handler can fire against a list that re-rendered underneath it, so
// a stale index must be inert rather than throwing or truncating.
check("an index past the end is a no-op", removeRedactionBoxAt(many, 9).length, 4)
check("a negative index is a no-op", removeRedactionBoxAt(many, -1).length, 4)
check("a non-integer index is a no-op", removeRedactionBoxAt(many, 1.5).length, 4)
check("removing from an empty list is a no-op", removeRedactionBoxAt([], 0).length, 0)

// --- page entries carry the index into the FULL list ------------------------
// The viewer renders one page at a time but stores every page's boxes in one
// array, so "the second box on page 1" is index 2 overall. Removal depends on
// that mapping being right.

check(
  "page 1 entries carry their global indices",
  pageBoxEntries(many, 1).map((e) => e.index),
  [0, 2],
)
check(
  "page 1 entries carry the right boxes",
  pageBoxEntries(many, 1).map((e) => e.box.x),
  [0.1, 0.3],
)
check("a page with no boxes yields nothing", pageBoxEntries(many, 9), [])
check(
  "removing by an index taken from pageBoxEntries drops the intended box",
  removeRedactionBoxAt(many, pageBoxEntries(many, 1)[1].index).map((x) => x.x),
  [0.1, 0.2, 0.4],
)

// --- rate-limit predicate ---------------------------------------------------
// Previously detected by string-comparing the user-facing sentence, so
// rewording the copy silently restored a Retry button that could only re-trip
// the limit. Asserted here against the error, not the display text.

check("the raw sentinel is recognised", isRateLimitedError({ message: "rate_limited" }), true)
check("an unrelated error is not", isRateLimitedError({ message: "boom" }), false)
check("the DISPLAY copy is not what is matched", isRateLimitedError({ message: "Too many requests. Try again in a minute." }), false)
check("null is handled", isRateLimitedError(null), false)
check("a bare string is handled", isRateLimitedError("rate_limited"), false)
check("an object with no message is handled", isRateLimitedError({ code: "429" }), false)

const fixture = new PdfCtor({ unit: "pt", format: "a4" })
fixture.setFont("helvetica", "normal")
fixture.setFontSize(18)
fixture.text("SECRET123", 72, 120)
const fixtureBuf = fixture.output("arraybuffer")
const fixtureBytes = new Uint8Array(fixtureBuf)
const originalCopy = fixtureBytes.slice()

const progressCalls = []
const burned = await burnRedactedPdf({
  bytes: fixtureBytes,
  boxes: [{ pageNumber: 1, x: 0, y: 0, width: 1, height: 1 }],
  title: "fixture.pdf",
  onProgress: (p) => progressCalls.push(p),
})
// Drives the "Redacting page N of M" status. Rasterizing a long Act takes
// close to a minute, and without this the UI could only show a spinner.
check("progress is reported per page", progressCalls, [{ page: 1, total: 1 }])
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
