// Builds a spec-valid single-page image-only PDF (real JPEG XObject +
// Catalog/Pages tree) so pdf.js can rasterize it and Tesseract can OCR it.
// Used by OCR accuracy tests — not the malformed makeImageOnlyPdf fixture,
// which exists to prove the text-layer parser's "no text operators" path.

import { Buffer } from "node:buffer"
import { createCanvas, GlobalFonts } from "@napi-rs/canvas"
import { existsSync } from "node:fs"

const FONT_CANDIDATES = [
  ["C:\\Windows\\Fonts\\times.ttf", "ScanSerif"],
  ["C:\\Windows\\Fonts\\georgia.ttf", "ScanSerif"],
  ["C:\\Windows\\Fonts\\arial.ttf", "ScanSerif"],
  ["/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf", "ScanSerif"],
  ["/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf", "ScanSerif"],
]

let registeredFamily = "sans-serif"
for (const [fontPath, family] of FONT_CANDIDATES) {
  if (existsSync(fontPath)) {
    GlobalFonts.registerFromPath(fontPath, family)
    registeredFamily = family
    break
  }
}

export const SCAN_GROUND_TRUTH = [
  "IN THE COURT OF APPEAL OF GUYANA",
  "Criminal Appeal No. 12 of 1973",
  "THE STATE v DHANNIE RAMSINGH",
  "(1973) 20 WIR 138",
  "",
  "The appellant was convicted of manslaughter following a trial in the High Court.",
  "Counsel for the appellant submitted that certain admissions were wrongly admitted",
  "as hearsay evidence and that the trial judge misdirected the jury on this point.",
  "The Court considered the relevant authorities at length before dismissing the appeal.",
  "Held, that the summing up was adequate and the conviction is affirmed.",
].join("\n")

export const SCAN_MUST_CONTAIN = [
  "COURT OF APPEAL OF GUYANA",
  "THE STATE v DHANNIE RAMSINGH",
  "(1973) 20 WIR 138",
  "manslaughter",
]

const wrapLines = (ctx, text, maxWidth) => {
  const out = []
  for (const paragraph of text.split("\n")) {
    if (!paragraph.trim()) {
      out.push("")
      continue
    }
    const words = paragraph.split(/\s+/)
    let line = ""
    for (const word of words) {
      const trial = line ? `${line} ${word}` : word
      if (ctx.measureText(trial).width <= maxWidth) {
        line = trial
      } else {
        if (line) out.push(line)
        line = word
      }
    }
    if (line) out.push(line)
  }
  return out
}

const renderLegalScanCanvas = (text = SCAN_GROUND_TRUTH, fontSize = 42, noiseRatio = 0) => {
  const dpi = 300
  const width = Math.round(8.5 * dpi)
  const height = Math.round(11 * dpi)
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext("2d")
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = "#111111"
  ctx.font = `${fontSize}px "${registeredFamily}"`
  ctx.textBaseline = "top"
  const margin = 220
  const maxWidth = width - margin * 2
  const lines = wrapLines(ctx, text, maxWidth)
  let y = margin
  const lineHeight = Math.round(fontSize * 1.45)
  for (const line of lines) {
    if (y + lineHeight > height - margin) break
    ctx.fillText(line, margin, y)
    y += line === "" ? Math.round(lineHeight * 0.6) : lineHeight
  }
  if (noiseRatio > 0) {
    const image = ctx.getImageData(0, 0, width, height)
    const data = image.data
    const count = Math.floor((width * height * noiseRatio) / 100)
    for (let n = 0; n < count; n++) {
      const i = Math.floor(Math.random() * width * height) * 4
      const v = Math.random() > 0.5 ? 0 : 255
      data[i] = v
      data[i + 1] = v
      data[i + 2] = v
    }
    ctx.putImageData(image, 0, 0)
  }
  return { canvas, width, height }
}

export const renderLegalScanJpeg = (text = SCAN_GROUND_TRUTH, jpegQuality = 92, noiseRatio = 0) => {
  const { canvas, width, height } = renderLegalScanCanvas(text, 42, noiseRatio)
  return { jpeg: canvas.toBuffer("image/jpeg", jpegQuality), width, height }
}

export const renderLegalScanPng = (text = SCAN_GROUND_TRUTH, fontSize = 42) => {
  const { canvas, width, height } = renderLegalScanCanvas(text, fontSize, 0)
  return { png: canvas.toBuffer("image/png"), width, height }
}

export const renderLegalScanWebp = (text = SCAN_GROUND_TRUTH) => {
  const { canvas, width, height } = renderLegalScanCanvas(text, 42, 0)
  try {
    return { webp: canvas.toBuffer("image/webp"), width, height, supported: true }
  } catch {
    return { webp: null, width, height, supported: false }
  }
}

const ascii = (s) => Buffer.from(s, "latin1")

export const makeValidScannedJpegPdf = (jpeg, pixelWidth, pixelHeight, name = "scanned-judgment.pdf") => {
  const pageW = 612
  const pageH = 792
  const contentStream = `q\n${pageW} 0 0 ${pageH} 0 0 cm\n/Im1 Do\nQ\n`
  const contentBuf = ascii(contentStream)

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>`,
    null,
    `<< /Length ${contentBuf.length} >>`,
  ]

  const parts = [ascii("%PDF-1.4\n")]
  const offsets = [0]
  let offset = parts[0].length

  const pushObj = (num, dict, streamBytes) => {
    offsets[num] = offset
    let chunk
    if (streamBytes) {
      chunk = Buffer.concat([
        ascii(`${num} 0 obj\n${dict}\nstream\n`),
        streamBytes,
        ascii("\nendstream\nendobj\n"),
      ])
    } else {
      chunk = ascii(`${num} 0 obj\n${dict}\nendobj\n`)
    }
    parts.push(chunk)
    offset += chunk.length
  }

  pushObj(1, objects[0], null)
  pushObj(2, objects[1], null)
  pushObj(3, objects[2], null)
  pushObj(
    4,
    `<< /Type /XObject /Subtype /Image /Width ${pixelWidth} /Height ${pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`,
    jpeg,
  )
  pushObj(5, objects[4], contentBuf)

  const xrefStart = offset
  const xrefLines = ["xref\n", `0 6\n`, "0000000000 65535 f \n"]
  for (let i = 1; i <= 5; i++) {
    xrefLines.push(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`)
  }
  const xrefBuf = ascii(xrefLines.join(""))
  parts.push(xrefBuf)
  offset += xrefBuf.length
  parts.push(ascii(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`))

  return new File([Buffer.concat(parts)], name, { type: "application/pdf" })
}

export const makeRenderedScanPdf = (opts = {}) => {
  const { jpeg, width, height } = renderLegalScanJpeg(
    opts.text ?? SCAN_GROUND_TRUTH,
    opts.jpegQuality ?? 92,
    opts.noiseRatio ?? 0,
  )
  return makeValidScannedJpegPdf(jpeg, width, height, opts.name ?? "scanned-judgment.pdf")
}
