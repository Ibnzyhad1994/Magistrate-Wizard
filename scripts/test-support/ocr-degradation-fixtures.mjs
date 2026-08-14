// Canvas OCR degradation ladder — same golden judgment, varied page quality.
// Used by the brutal ingest circuit (Stage 4–6).

import { Buffer } from "node:buffer"
import { createCanvas, GlobalFonts } from "@napi-rs/canvas"
import { existsSync } from "node:fs"
import { makeValidScannedJpegPdf, SCAN_GROUND_TRUTH } from "./scanned-pdf-fixtures.mjs"

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

export const SYMBOLS_GOLDEN =
  "IN THE COURT OF APPEAL OF GUYANA. " +
  "See § 12 and ¶ 4 — “naïve café” testimony of José François O'Neil-Smith. " +
  "THE STATE v DHANNIE RAMSINGH (1973) 20 WIR 138. " +
  "The appellant was convicted of manslaughter following a trial in the High Court. " +
  "Counsel for the appellant submitted that certain admissions were wrongly admitted " +
  "as hearsay evidence and that the trial judge misdirected the jury on this point. " +
  "The Court considered the relevant authorities at length before dismissing the appeal."

export const SYMBOLS_MUST_RAW = ["§", "¶", "—", "“", "”", "naïve", "café", "José"]

const wrapLines = (ctx, text, maxWidth) => {
  const out = []
  for (const paragraph of String(text).split("\n")) {
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

/**
 * @param {object} opts
 * @param {string} [opts.text]
 * @param {number} [opts.dpi] default 300
 * @param {number} [opts.fontSize] px at the given dpi (default scales from 42@300)
 * @param {number} [opts.noiseRatio] salt-pepper % of pixels
 * @param {number} [opts.skewDeg]
 * @param {number} [opts.rotateDeg] 0|90|180|270
 * @param {boolean} [opts.invert]
 * @param {boolean} [opts.lowContrast]
 * @param {boolean} [opts.watermark]
 * @param {boolean} [opts.stamp]
 * @param {boolean} [opts.bleed]
 * @param {boolean} [opts.photocopy]
 * @param {boolean} [opts.twoColumn]
 * @param {'white'|'transparent'} [opts.background]
 */
export const renderDegradedScanCanvas = (opts = {}) => {
  const dpi = opts.dpi ?? 300
  const fontSize = opts.fontSize ?? Math.max(8, Math.round(42 * (dpi / 300)))
  const text = opts.text ?? SCAN_GROUND_TRUTH
  let width = Math.round(8.5 * dpi)
  let height = Math.round(11 * dpi)
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext("2d")

  if (opts.background === "transparent") {
    ctx.clearRect(0, 0, width, height)
  } else {
    ctx.fillStyle = opts.invert ? "#111111" : opts.lowContrast ? "#c8c8c8" : "#ffffff"
    ctx.fillRect(0, 0, width, height)
  }

  ctx.save()
  if (opts.rotateDeg === 90) {
    ctx.translate(width, 0)
    ctx.rotate(Math.PI / 2)
    ;[width, height] = [height, width]
  } else if (opts.rotateDeg === 180) {
    ctx.translate(width, height)
    ctx.rotate(Math.PI)
  } else if (opts.rotateDeg === 270) {
    ctx.translate(0, height)
    ctx.rotate(-Math.PI / 2)
    ;[width, height] = [height, width]
  }

  if (opts.skewDeg) {
    const rad = (opts.skewDeg * Math.PI) / 180
    ctx.transform(1, Math.tan(rad), 0, 1, 0, 0)
  }

  ctx.fillStyle = opts.invert ? "#eeeeee" : opts.lowContrast ? "#9a9a9a" : "#111111"
  ctx.font = `${fontSize}px "${registeredFamily}"`
  ctx.textBaseline = "top"
  const margin = Math.round(0.75 * dpi)
  const maxWidth = width - margin * 2
  const lineHeight = Math.round(fontSize * 1.45)

  if (opts.twoColumn) {
    const colGap = Math.round(0.35 * dpi)
    const colWidth = Math.floor((maxWidth - colGap) / 2)
    const paragraphs = String(text).split("\n")
    const mid = Math.ceil(paragraphs.length / 2)
    const leftText = paragraphs.slice(0, mid).join("\n")
    const rightText = paragraphs.slice(mid).join("\n")
    const drawCol = (t, x0) => {
      const lines = wrapLines(ctx, t, colWidth)
      let y = margin
      for (const line of lines) {
        if (y + lineHeight > height - margin) break
        ctx.fillText(line, x0, y)
        y += line === "" ? Math.round(lineHeight * 0.6) : lineHeight
      }
    }
    drawCol(leftText, margin)
    drawCol(rightText, margin + colWidth + colGap)
  } else {
    const lines = wrapLines(ctx, text, maxWidth)
    let y = margin
    for (const line of lines) {
      if (y + lineHeight > height - margin) break
      ctx.fillText(line, margin, y)
      y += line === "" ? Math.round(lineHeight * 0.6) : lineHeight
    }
  }

  if (opts.watermark) {
    ctx.save()
    ctx.globalAlpha = 0.22
    ctx.fillStyle = "#666666"
    ctx.font = `${Math.round(dpi * 0.55)}px "${registeredFamily}"`
    ctx.translate(width * 0.15, height * 0.55)
    ctx.rotate(-0.4)
    ctx.fillText("COPY", 0, 0)
    ctx.restore()
  }

  if (opts.stamp) {
    ctx.save()
    ctx.strokeStyle = "#cc0000"
    ctx.lineWidth = Math.max(2, Math.round(dpi / 100))
    ctx.font = `bold ${Math.round(fontSize * 1.2)}px "${registeredFamily}"`
    ctx.fillStyle = "#cc0000"
    ctx.globalAlpha = 0.85
    const stampY = margin + Math.round(lineHeight * 2.2)
    ctx.strokeRect(margin, stampY, Math.round(dpi * 2.2), Math.round(dpi * 0.55))
    ctx.fillText("FILED", margin + 12, stampY + 10)
    ctx.restore()
  }

  if (opts.bleed) {
    ctx.save()
    ctx.globalAlpha = 0.12
    ctx.fillStyle = "#333333"
    ctx.font = `${fontSize}px "${registeredFamily}"`
    ctx.scale(-1, 1)
    ctx.fillText("verso bleed through sample line", -width + margin, height - margin * 2)
    ctx.restore()
  }

  ctx.restore()

  // Photocopy crush after geometry
  if (opts.photocopy || opts.noiseRatio || opts.fax) {
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const data = image.data
    if (opts.photocopy) {
      for (let i = 0; i < data.length; i += 4) {
        const g = data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11
        const crushed = g < 140 ? Math.max(0, g - 40) : Math.min(255, g + 35)
        data[i] = crushed
        data[i + 1] = crushed
        data[i + 2] = crushed
      }
    }
    if (opts.noiseRatio) {
      const count = Math.floor((canvas.width * canvas.height * opts.noiseRatio) / 100)
      for (let n = 0; n < count; n++) {
        const i = Math.floor(Math.random() * canvas.width * canvas.height) * 4
        const v = Math.random() > 0.5 ? 0 : 255
        data[i] = v
        data[i + 1] = v
        data[i + 2] = v
      }
    }
    ctx.putImageData(image, 0, 0)
  }

  // Fax-ish downsample then upscale (204×98-ish feel)
  if (opts.fax) {
    const fw = Math.max(1, Math.round(canvas.width * (204 / 300)))
    const fh = Math.max(1, Math.round(canvas.height * (98 / 300)))
    const small = createCanvas(fw, fh)
    const sctx = small.getContext("2d")
    sctx.drawImage(canvas, 0, 0, fw, fh)
    const out = createCanvas(canvas.width, canvas.height)
    const octx = out.getContext("2d")
    octx.imageSmoothingEnabled = false
    octx.drawImage(small, 0, 0, canvas.width, canvas.height)
    return { canvas: out, width: out.width, height: out.height }
  }

  return { canvas, width: canvas.width, height: canvas.height }
}

export const renderDegradedJpeg = (opts = {}) => {
  const { canvas, width, height } = renderDegradedScanCanvas(opts)
  const quality = opts.jpegQuality ?? 92
  return { jpeg: canvas.toBuffer("image/jpeg", quality), width, height, canvas }
}

export const renderDegradedPng = (opts = {}) => {
  const { canvas, width, height } = renderDegradedScanCanvas(opts)
  return { png: canvas.toBuffer("image/png"), width, height, canvas }
}

export const makeDegradedScanPdf = (opts = {}) => {
  const { jpeg, width, height } = renderDegradedJpeg(opts)
  return makeValidScannedJpegPdf(jpeg, width, height, opts.name ?? "degraded-scan.pdf")
}

/** Blank white page (adversarial — must not invent prose). */
export const makeBlankScanPdf = (name = "blank-scan.pdf") => {
  const dpi = 150
  const width = Math.round(8.5 * dpi)
  const height = Math.round(11 * dpi)
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext("2d")
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, width, height)
  const jpeg = canvas.toBuffer("image/jpeg", 90)
  return makeValidScannedJpegPdf(jpeg, width, height, name)
}

/** Logo / crest only — no body text. */
export const makeLogoOnlyPng = () => {
  const canvas = createCanvas(800, 600)
  const ctx = canvas.getContext("2d")
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, 800, 600)
  ctx.strokeStyle = "#333333"
  ctx.lineWidth = 8
  ctx.beginPath()
  ctx.arc(400, 280, 120, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = "#555555"
  ctx.font = `bold 28px "${registeredFamily}"`
  ctx.fillText("SEAL", 360, 290)
  return canvas.toBuffer("image/png")
}

export const makeOneByOnePng = () => {
  const canvas = createCanvas(1, 1)
  const ctx = canvas.getContext("2d")
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, 1, 1)
  return canvas.toBuffer("image/png")
}

/** Statute-style two-column table text for layout stage. */
export const STATUTE_TABLE_TEXT = [
  "SCHEDULE — Offences and Penalties",
  "Section\tOffence\tMaximum penalty",
  "§ 3\tAssault\tFine or imprisonment for two years",
  "§ 4\tTheft\tImprisonment for five years",
  "§ 5\tManslaughter\tImprisonment for life",
  "",
  "THE STATE v DHANNIE RAMSINGH (1973) 20 WIR 138",
  "The appellant was convicted of manslaughter following a trial in the High Court.",
  "Counsel for the appellant submitted that certain admissions were wrongly admitted",
  "as hearsay evidence and that the trial judge misdirected the jury on this point.",
  "The Court considered the relevant authorities at length before dismissing the appeal.",
].join("\n")
