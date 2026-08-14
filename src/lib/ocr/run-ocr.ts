/**
 * Real OCR entry point for scanned / unreadable-text-layer PDFs.
 * Always returns an ExtractionEnvelope — never throws for a normal
 * (even totally unreadable) file. Output still passes through
 * sanitizeExtractedText + assessExtractionQuality; those gates are
 * engine-agnostic and are not bypassed because Tesseract produced the
 * bytes.
 */

import type { ExtractionEnvelope } from "@/lib/extraction-pipeline"
import { assessExtractionQuality, CLEAN_SCORE_THRESHOLD } from "@/lib/extraction-quality"
import { LOW_OCR_MEAN_CONFIDENCE, MAX_OCR_PAGES, MIN_OCR_MEAN_CONFIDENCE } from "@/lib/ocr/constants"
import { extractEmbeddedJpegImages } from "@/lib/ocr/embedded-images"
import { recognizeImage, yieldForUi } from "@/lib/ocr/engine"
import { postprocessOcrText } from "@/lib/ocr/postprocess"
import { rasterizePdfPages } from "@/lib/ocr/rasterize-pdf"
import { sanitizeExtractedText } from "@/lib/text-sanitize"
import type { PdfPageResult } from "@/lib/pdf-text-extraction"

const unavailable = (warnings: string[]): ExtractionEnvelope => ({
  status: "requires_ocr",
  method: "none",
  text: "",
  charCount: 0,
  qualityScore: null,
  characterQuality: null,
  structuralQuality: null,
  warnings,
  ocrUsed: false,
  requiresReview: true,
  pages: [],
  pageCount: 0,
  unreadableReason: "no_text_found",
})

const failedOcr = (warnings: string[], ocrUsed: boolean): ExtractionEnvelope => ({
  status: "requires_ocr",
  method: "ocr",
  text: "",
  charCount: 0,
  qualityScore: null,
  characterQuality: null,
  structuralQuality: null,
  warnings,
  ocrUsed,
  requiresReview: true,
  pages: [],
  pageCount: 0,
  unreadableReason: "no_text_found",
})

interface PageImage {
  pageNumber: number
  bytes: Uint8Array
}

const collectPageImages = async (file: File): Promise<{ images: PageImage[]; warnings: string[] }> => {
  const warnings: string[] = []

  try {
    const embedded = await extractEmbeddedJpegImages(file)
    const substantial = embedded.filter((img) => img.bytes.length >= 20_000)
    if (substantial.length > 0) {
      return {
        images: substantial.slice(0, MAX_OCR_PAGES).map((img, i) => ({ pageNumber: i + 1, bytes: img.bytes })),
        warnings,
      }
    }
  } catch (e) {
    console.error("Embedded JPEG extraction for OCR failed:", e)
  }

  try {
    const raster = await rasterizePdfPages(file)
    if (raster.length > 0) {
      if (raster.length >= MAX_OCR_PAGES) {
        warnings.push(
          `Only the first ${MAX_OCR_PAGES} pages were recognized — paste any remaining pages manually if needed.`,
        )
      }
      return {
        images: raster.map((p) => ({ pageNumber: p.pageNumber, bytes: p.png })),
        warnings,
      }
    }
  } catch (e) {
    const name = e && typeof e === "object" && "name" in e ? String((e as { name: string }).name) : ""
    if (name !== "InvalidPDFException") {
      console.error("PDF rasterization for OCR failed:", e)
      warnings.push("Could not render PDF pages for text recognition.")
    }
  }

  return { images: [], warnings }
}

const toRecognizeInput = (bytes: Uint8Array): Buffer | Blob => {
  if (typeof window === "undefined") {
    return Buffer.from(bytes)
  }
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return new Blob([copy], { type: "image/png" })
}

export const runOcr = async (file: File): Promise<ExtractionEnvelope> => {
  const { images, warnings: collectWarnings } = await collectPageImages(file)
  if (images.length === 0) {
    return unavailable([
      ...collectWarnings,
      "No scanned pages could be rendered for text recognition. Paste the text manually, or try a different copy of the document.",
    ])
  }

  const pageTexts: PdfPageResult[] = []
  const confidences: number[] = []
  const warnings = [...collectWarnings]

  for (let i = 0; i < images.length; i++) {
    const image = images[i]
    try {
      const result = await recognizeImage(toRecognizeInput(image.bytes))
      const cleaned = postprocessOcrText(result.text)
      pageTexts.push({
        pageNumber: image.pageNumber,
        text: cleaned,
        characterCount: cleaned.length,
      })
      confidences.push(result.confidence)
    } catch (e) {
      console.error(`OCR failed on page ${image.pageNumber}:`, e)
      warnings.push(`Text recognition failed on page ${image.pageNumber}.`)
    }
    // Let the admin tab paint between pages — critical on slower machines.
    if (i < images.length - 1) await yieldForUi()
  }

  if (pageTexts.length === 0) {
    return failedOcr(
      [...warnings, "Text recognition ran but could not read any page of this document."],
      true,
    )
  }

  const combined = pageTexts
    .map((p) => p.text)
    .filter((t) => t.trim())
    .join("\n\n")
  const sanitized = sanitizeExtractedText(combined)
  const quality = assessExtractionQuality(sanitized.text)
  const meanConfidence =
    confidences.length > 0 ? confidences.reduce((s, n) => s + n, 0) / confidences.length : 0

  if (sanitized.removedCount > 0) {
    warnings.push(`Removed ${sanitized.removedCount} character(s) that cannot be safely stored from recognized text.`)
  }
  warnings.push(...quality.warnings)
  if (meanConfidence > 0 && meanConfidence < LOW_OCR_MEAN_CONFIDENCE) {
    warnings.push("Recognized text has modest engine confidence — please read it against the original scan.")
  }

  if (!quality.passed || meanConfidence < MIN_OCR_MEAN_CONFIDENCE) {
    return failedOcr(
      [
        ...warnings,
        meanConfidence < MIN_OCR_MEAN_CONFIDENCE && quality.passed
          ? "Text recognition confidence was too low to trust automatically."
          : "Recognized text did not pass quality checks and was withheld.",
      ],
      true,
    )
  }

  const status = quality.score >= CLEAN_SCORE_THRESHOLD && meanConfidence >= LOW_OCR_MEAN_CONFIDENCE ? "extracted" : "low_quality"
  const pages: PdfPageResult[] = pageTexts.map((p) => {
    const pageSanitized = sanitizeExtractedText(p.text)
    return { pageNumber: p.pageNumber, text: pageSanitized.text, characterCount: pageSanitized.text.length }
  })

  return {
    status,
    method: "ocr",
    text: sanitized.text,
    charCount: sanitized.text.length,
    qualityScore: quality.score,
    characterQuality: quality.characterQuality,
    structuralQuality: quality.structuralQuality,
    warnings,
    ocrUsed: true,
    requiresReview: true,
    pages,
    pageCount: pages.length,
    unreadableReason: null,
  }
}
