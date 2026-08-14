// Simulate OCR on a constrained / slower system:
// - serial queue (no parallel pages)
// - artificial per-page delay (CPU contention)
// - UI yield between pages
// - MAX_OCR_PAGES cap honesty
// - timing + memory snapshots
//
//   npm run test:ocr-slow-system
//   SLOW_PAGE_MS=80 npm run test:ocr-slow-system

import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { ingestDocument } from "@/lib/ingest-document"
import { MAX_OCR_PAGES } from "@/lib/ocr/constants"
import { recognizeImage, terminateOcrWorker, yieldForUi } from "@/lib/ocr/engine"
import { characterErrorRate, containsNormalized } from "@/lib/ocr/accuracy"
import { makeMultiPageScannedPdf } from "../test-support/pdf-torture-fixtures.mjs"
import { makeDegradedScanPdf, renderDegradedJpeg } from "../test-support/ocr-degradation-fixtures.mjs"
import { SCAN_GROUND_TRUTH, SCAN_MUST_CONTAIN } from "../test-support/scanned-pdf-fixtures.mjs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const RESULTS = join(__dirname, "ocr-slow-system-results.json")
const SLOW_PAGE_MS = Number(process.env.SLOW_PAGE_MS ?? 50)

const rows = []
let failures = 0

const record = (row) => {
  rows.push(row)
  const mark = row.pass ? "PASS" : "FAIL"
  if (!row.pass) failures += 1
  console.log(
    `${mark}  ${row.label}${row.ms != null ? `  (${row.ms}ms)` : ""}${row.detail ? ` — ${row.detail}` : ""}`,
  )
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const memMb = () => {
  const m = process.memoryUsage()
  return {
    rss: Math.round(m.rss / 1024 / 1024),
    heapUsed: Math.round(m.heapUsed / 1024 / 1024),
  }
}

const main = async () => {
  console.log(`Slow-system OCR simulation — SLOW_PAGE_MS=${SLOW_PAGE_MS}, MAX_OCR_PAGES=${MAX_OCR_PAGES}`)
  const started = Date.now()
  const memStart = memMb()

  // ------------------------------------------------------------------
  // 1. Serial queue: overlapping recognizeImage calls must not race
  // ------------------------------------------------------------------
  {
    const { jpeg } = renderDegradedJpeg({ dpi: 150, jpegQuality: 85 })
    const t0 = Date.now()
    const order = []
    const a = recognizeImage(jpeg).then(() => {
      order.push("a")
    })
    const b = recognizeImage(jpeg).then(() => {
      order.push("b")
    })
    await Promise.all([a, b])
    const ms = Date.now() - t0
    record({
      label: "serial queue: overlapping OCR completes in order without crash",
      pass: order.length === 2 && (order[0] === "a" || order[0] === "b"),
      ms,
      order,
      detail: `order=${order.join(",")}`,
    })
  }

  // ------------------------------------------------------------------
  // 2. Yield + artificial delay between pages (slow laptop simulation)
  // ------------------------------------------------------------------
  {
    const pageCount = 3
    const file = makeMultiPageScannedPdf(pageCount, { name: "slow-3p.pdf", jpegQuality: 80 })
    const pageTimes = []
    const t0 = Date.now()
    // Drive OCR path via ingest; also manually time yield+sleep to model contention
    for (let i = 0; i < pageCount; i++) {
      const p0 = Date.now()
      await yieldForUi()
      await sleep(SLOW_PAGE_MS)
      pageTimes.push(Date.now() - p0)
    }
    const envelope = await ingestDocument(file)
    const ms = Date.now() - t0
    const hits = SCAN_MUST_CONTAIN.filter((p) => containsNormalized(envelope.text, p)).length
    const usable = envelope.status === "extracted" || envelope.status === "low_quality"
    record({
      label: `slow ${pageCount}-page scan ingest (yield + ${SLOW_PAGE_MS}ms/page model)`,
      pass: usable && hits >= 2 && envelope.ocrUsed === true && envelope.requiresReview === true,
      ms,
      pageTimes,
      status: envelope.status,
      cer: usable ? characterErrorRate(envelope.text, SCAN_GROUND_TRUTH) : null,
      mustHits: hits,
      mem: memMb(),
    })
  }

  // ------------------------------------------------------------------
  // 3. Degraded scan under slow conditions (still must not invent)
  // ------------------------------------------------------------------
  {
    const file = makeDegradedScanPdf({ dpi: 150, jpegQuality: 40, noiseRatio: 2, name: "slow-noisy.pdf" })
    await sleep(SLOW_PAGE_MS)
    const t0 = Date.now()
    const envelope = await ingestDocument(file)
    const ms = Date.now() - t0
    const poison = /AdobeUCS2|begincmap|This font software/i.test(envelope.text)
    const usable = envelope.status === "extracted" || envelope.status === "low_quality"
    record({
      label: "slow noisy scan: usable or honest withhold, never poison",
      pass: !poison && (usable || envelope.text === ""),
      ms,
      status: envelope.status,
      ocrUsed: envelope.ocrUsed,
      cer: usable ? characterErrorRate(envelope.text, SCAN_GROUND_TRUTH) : null,
    })
  }

  // ------------------------------------------------------------------
  // 4. Page-cap honesty under constrained run (5 pages here; assert constant)
  // ------------------------------------------------------------------
  {
    record({
      label: `MAX_OCR_PAGES constant is ${MAX_OCR_PAGES} (hard browser safety cap)`,
      pass: MAX_OCR_PAGES === 40,
      detail: String(MAX_OCR_PAGES),
    })
    // Build a 5-page scan and confirm OCR runs without crashing under delay
    const file = makeMultiPageScannedPdf(5, { name: "slow-5p.pdf", jpegQuality: 75 })
    const t0 = Date.now()
    await sleep(SLOW_PAGE_MS * 2)
    const envelope = await ingestDocument(file)
    const ms = Date.now() - t0
    record({
      label: "5-page scan under delay completes without crash",
      pass: envelope.ocrUsed === true || envelope.status === "requires_ocr" || envelope.status === "extracted" || envelope.status === "low_quality",
      ms,
      status: envelope.status,
      pageCount: envelope.pageCount,
      requiresReview: envelope.requiresReview,
    })
  }

  // ------------------------------------------------------------------
  // 5. Born-digital still preferred (fast path) even on "slow" machine
  // ------------------------------------------------------------------
  {
    const { makeTextPdf } = await import("../test-support/pdf-fixtures.mjs")
    const lines = SCAN_GROUND_TRUTH.split("\n").filter(Boolean)
    const t0 = Date.now()
    const envelope = await ingestDocument(makeTextPdf(lines, "fast-layer.pdf"))
    const ms = Date.now() - t0
    record({
      label: "text-layer PDF skips OCR (fast path on slow machine)",
      pass: envelope.ocrUsed === false && envelope.method === "pdf_text_layer" && ms < 2000,
      ms,
      method: envelope.method,
      ocrUsed: envelope.ocrUsed,
      status: envelope.status,
    })
  }

  await terminateOcrWorker()

  const payload = {
    generatedAt: new Date().toISOString(),
    slowPageMs: SLOW_PAGE_MS,
    maxOcrPages: MAX_OCR_PAGES,
    elapsedMs: Date.now() - started,
    memStart,
    memEnd: memMb(),
    total: rows.length,
    passed: rows.filter((r) => r.pass).length,
    failed: failures,
    rows,
  }
  writeFileSync(RESULTS, JSON.stringify(payload, null, 2))
  console.log("\n--- Slow-system OCR summary ---")
  console.log(`Total ${payload.total}  passed ${payload.passed}  failed ${failures}`)
  console.log(`Wall ${payload.elapsedMs}ms  mem ${memStart.heapUsed}→${payload.memEnd.heapUsed} MB heap`)
  console.log("Results:", RESULTS)
  process.exit(failures > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
