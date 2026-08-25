/**
 * Extraction pipeline orchestrator — the single authoritative entry point
 * for "did we get usable text out of this document."
 *
 * Pipeline: pdf.js text layer (primary) → homemade stream-scan fallback /
 * cross-check → if neither yields usable text and the file is not
 * user-password-encrypted, OCR fallback (src/lib/ocr/run-ocr.ts) →
 * sanitize (text-sanitize.ts) → quality gate (extraction-quality.ts) →
 * one of five explicit statuses. Nothing downstream of this module should
 * ever treat raw extractor output as authoritative — only an
 * ExtractionEnvelope with status "extracted" or "low_quality" carries
 * text that is safe to propose metadata from or store as searchable text.
 *
 * OCR is attempted only for no_text_found / unsupported_font_encoding /
 * too_short. User-password PDFs and quality-failed (wrong-stream)
 * extractions are not sent to OCR. Owner-password-only PDFs are opened
 * by pdf.js with an empty password and extracted. Successful OCR always
 * sets requiresReview: true.
 */

import { isAbortError, throwIfAborted } from "@/lib/async-timeout"
import {
  extractPdfTextLayer,
  isPdfExtractionSupported,
  type PdfPageResult,
  type PdfUnreadableReason,
} from "@/lib/pdf-text-extraction"
import { sanitizeExtractedText } from "@/lib/text-sanitize"
import {
  assessExtractionQuality,
  CLEAN_SCORE_THRESHOLD,
  type QualityBucket,
  type QualityHardFailReason,
} from "@/lib/extraction-quality"

export type ExtractionStatus = "pending" | "extracted" | "low_quality" | "requires_ocr" | "failed"

export type ExtractionMethod =
  | "pdf_text_layer"
  | "txt_file"
  | "markdown"
  | "docx"
  | "manual_paste"
  | "ocr"
  | "none"

export interface ExtractionEnvelope {
  status: ExtractionStatus
  method: ExtractionMethod
  /** Sanitized, quality-gated text. Empty string whenever status is "requires_ocr" or "failed" — never populated with unvetted text, even partially. */
  text: string
  /** Character count of `text` (0 when text is withheld). Diagnostic only. */
  charCount: number
  /** 0-1, or null when no quality assessment ran (e.g. no text layer was found at all). Not shown to the curator as a precise number. */
  qualityScore: number | null
  /** Section 7: character quality and structural quality shown as separate, coarse, plain-language signals — never a raw percentage. `null` when no quality assessment ran. */
  characterQuality: QualityBucket | null
  structuralQuality: QualityBucket | null
  warnings: string[]
  ocrUsed: boolean
  /** True whenever status is anything other than "extracted" — the Review Queue uses this to prompt closer curator attention, independent of the publication-validation gate. */
  requiresReview: boolean
  /** Set only when status is "failed" — the specific reason `assessExtractionQuality` rejected the text (see QualityHardFailReason), so a UI can show a plain-language explanation instead of one generic "extraction failed" message. `undefined`/`null` for every other status. */
  hardFailReason?: QualityHardFailReason | null
  /**
   * Page-aware breakdown (PRODUCTION DOCUMENT INGESTION PHASE, Section 5).
   * Only populated for method "pdf_text_layer" — a .txt file or manually
   * pasted text has no genuine page concept, so this is `[]`/`0` for
   * those methods rather than a fabricated single page. See
   * PdfPageResult/PdfExtractionResult in pdf-text-extraction.ts for the
   * attribution heuristic and its honesty boundary. Stored inside the
   * existing `extracted_metadata` jsonb column (no migration) — see
   * use-import-jobs.ts.
   */
  pages: PdfPageResult[]
  pageCount: number
  /** SIMPLE AND TIGHT ingestion pass: why nothing usable was extracted, when applicable (see PdfUnreadableReason) — lets a UI show a specific, honest, plain-language reason ("This PDF is protected"/"Uses a font we can't read yet"/"Looks like a scanned document") instead of one generic "OCR required" message for every case. `null` whenever status is "extracted"/"low_quality"/"pending", or for non-PDF methods. */
  unreadableReason: PdfUnreadableReason | null
}

const TEXT_LAYER_UNREADABLE_MESSAGE: Record<PdfUnreadableReason, string> = {
  encrypted:
    "This PDF is protected with a password, so its text could not be read automatically. If you have an unprotected copy, try uploading that instead — otherwise paste the text manually.",
  unsupported_font_encoding:
    "This PDF has a text layer, but uses an embedded font encoding the lightweight parser cannot decode. Trying the full PDF renderer, then text recognition if needed.",
  no_text_found:
    "No usable text layer was found. Trying text recognition if this is a scan.",
}

const shouldAttemptOcr = (reason: PdfUnreadableReason | null): boolean => {
  return reason === "no_text_found" || reason === "unsupported_font_encoding"
}

/** Diagnostic: pdf.js recovered substantially more text than the stream scan. Kept as a cross-check signal, not a selection rule — pdf.js is primary. */
export const PDFJS_FULLER_TEXT_RATIO = 1.25

export function shouldPreferPdfjsText(homemadeLength: number, pdfjsLength: number): boolean {
  if (pdfjsLength <= 0) return false
  return pdfjsLength > homemadeLength * PDFJS_FULLER_TEXT_RATIO
}

export interface ExtractionProgress {
  page: number
  total: number
  phase: "ocr"
}

export interface ExtractionPipelineOptions {
  onOcrProgress?: (info: ExtractionProgress) => void
  maxOcrPages?: number
  signal?: AbortSignal
}

const envelopeFromSanitizedText = (
  rawText: string,
  pages: PdfPageResult[],
  method: ExtractionEnvelope["method"],
  extraWarnings: string[],
): ExtractionEnvelope | null => {
  const sanitized = sanitizeExtractedText(rawText)
  const quality = assessExtractionQuality(sanitized.text)
  const warnings = [...extraWarnings, ...quality.warnings]
  if (!quality.passed) return null
  const status: ExtractionStatus = quality.score >= CLEAN_SCORE_THRESHOLD ? "extracted" : "low_quality"
  const sanitizedPages: PdfPageResult[] = pages.map((p) => {
    const pageSanitized = sanitizeExtractedText(p.text)
    return { pageNumber: p.pageNumber, text: pageSanitized.text, characterCount: pageSanitized.text.length }
  })
  return {
    status,
    method,
    text: sanitized.text,
    charCount: sanitized.text.length,
    qualityScore: quality.score,
    characterQuality: quality.characterQuality,
    structuralQuality: quality.structuralQuality,
    warnings,
    ocrUsed: false,
    requiresReview: status !== "extracted",
    pages: sanitizedPages,
    pageCount: sanitizedPages.length,
    unreadableReason: null,
  }
}

const encryptedEnvelope = (warnings: string[]): ExtractionEnvelope => ({
  status: "requires_ocr",
  method: "pdf_text_layer",
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
  unreadableReason: "encrypted",
})

const tryOcrFallback = async (
  file: File,
  priorReason: PdfUnreadableReason | null,
  priorWarnings: string[],
  options?: ExtractionPipelineOptions,
): Promise<ExtractionEnvelope> => {
  throwIfAborted(options?.signal)
  if (priorReason === "encrypted") {
    return encryptedEnvelope(priorWarnings)
  }
  try {
    const { runOcr: runOcrEngine } = await import("@/lib/ocr/run-ocr")
    const ocr = await runOcrEngine(file, {
      onProgress: options?.onOcrProgress
        ? (page, total) => options.onOcrProgress?.({ page, total, phase: "ocr" })
        : undefined,
      maxPages: options?.maxOcrPages,
      signal: options?.signal,
    })
    if (ocr.status === "extracted" || ocr.status === "low_quality") {
      return ocr
    }
    return {
      ...ocr,
      status: "requires_ocr",
      unreadableReason: priorReason ?? ocr.unreadableReason,
      warnings: [...priorWarnings, ...ocr.warnings],
      requiresReview: true,
    }
  } catch (e) {
    if (isAbortError(e)) throw e
    console.error("OCR fallback failed:", e)
    return {
      status: "requires_ocr",
      method: "none",
      text: "",
      charCount: 0,
      qualityScore: null,
      characterQuality: null,
      structuralQuality: null,
      warnings: [...priorWarnings, "Text recognition could not run in this environment. Paste the text manually."],
      ocrUsed: false,
      requiresReview: true,
      pages: [],
      pageCount: 0,
      unreadableReason: priorReason,
    }
  }
}

function pendingEnvelope(): ExtractionEnvelope {
  return {
    status: "pending",
    method: "none",
    text: "",
    charCount: 0,
    qualityScore: null,
    characterQuality: null,
    structuralQuality: null,
    warnings: [],
    ocrUsed: false,
    requiresReview: true,
    pages: [],
    pageCount: 0,
    unreadableReason: null,
  }
}

const homemadeEnvelopeFromRaw = (
  raw: { text: string; pages: PdfPageResult[] },
  extraWarnings: string[],
): ExtractionEnvelope | null => {
  const sanitized = sanitizeExtractedText(raw.text)
  const quality = assessExtractionQuality(sanitized.text)
  const warnings = [...extraWarnings, ...quality.warnings]
  if (sanitized.removedCount > 0) {
    const parts: string[] = []
    if (sanitized.hadNulBytes) parts.push("NUL bytes")
    if (sanitized.hadInvalidSurrogates) parts.push("invalid surrogate sequences")
    if (sanitized.hadOtherControlChars) parts.push("control characters")
    warnings.push(
      `Removed ${sanitized.removedCount} character(s) that cannot be safely stored (${parts.join(", ")}) — likely a sign the source stream was not genuine document text.`,
    )
  }
  if (!quality.passed) return null
  const status: ExtractionStatus = quality.score >= CLEAN_SCORE_THRESHOLD ? "extracted" : "low_quality"
  const pages: PdfPageResult[] = raw.pages.map((p) => {
    const pageSanitized = sanitizeExtractedText(p.text)
    return { pageNumber: p.pageNumber, text: pageSanitized.text, characterCount: pageSanitized.text.length }
  })
  return {
    status,
    method: "pdf_text_layer",
    text: sanitized.text,
    charCount: sanitized.text.length,
    qualityScore: quality.score,
    characterQuality: quality.characterQuality,
    structuralQuality: quality.structuralQuality,
    warnings,
    ocrUsed: false,
    requiresReview: status !== "extracted",
    pages,
    pageCount: pages.length,
    unreadableReason: null,
  }
}

/**
 * Runs the full pipeline against a PDF File. Never throws for a normal
 * (even totally unusable) PDF — every failure mode is communicated via
 * `status`, not an exception. AbortError is rethrown so bulk cancel can
 * persist a terminal cancelled row.
 */
export async function runPdfExtractionPipeline(
  file: File,
  options?: ExtractionPipelineOptions,
): Promise<ExtractionEnvelope> {
  throwIfAborted(options?.signal)

  const { extractPdfjsTextContent } = await import("@/lib/ocr/rasterize-pdf")
  const pdfjsResult = await extractPdfjsTextContent(file, { signal: options?.signal })

  if (!pdfjsResult.ok && pdfjsResult.reason === "aborted") {
    const err = new Error("Cancelled")
    err.name = "AbortError"
    throw err
  }

  if (!pdfjsResult.ok && pdfjsResult.reason === "need_password") {
    return encryptedEnvelope([TEXT_LAYER_UNREADABLE_MESSAGE.encrypted])
  }

  let homemade: Awaited<ReturnType<typeof extractPdfTextLayer>> | null = null
  if (isPdfExtractionSupported()) {
    try {
      homemade = await extractPdfTextLayer(file)
    } catch (e) {
      console.error("PDF stream-scan extraction threw an unexpected error:", e)
    }
  }

  if (pdfjsResult.ok && pdfjsResult.text.trim()) {
    const extra = [...pdfjsResult.warnings]
    extra.push("Text recovered via the PDF renderer.")
    if (homemade?.text && shouldPreferPdfjsText(homemade.text.length, pdfjsResult.text.length)) {
      extra.push("The renderer recovered more of the document than the lightweight parser.")
    }
    const envelope = envelopeFromSanitizedText(pdfjsResult.text, pdfjsResult.pages, "pdf_text_layer", extra)
    if (envelope) return envelope
    const quality = assessExtractionQuality(sanitizeExtractedText(pdfjsResult.text).text)
    if (quality.hardFailReason !== "too_short") {
      return {
        status: "failed",
        method: "pdf_text_layer",
        text: "",
        charCount: 0,
        qualityScore: quality.score,
        characterQuality: quality.characterQuality,
        structuralQuality: quality.structuralQuality,
        warnings: [...extra, ...quality.warnings],
        ocrUsed: false,
        requiresReview: true,
        pages: [],
        pageCount: 0,
        unreadableReason: null,
        hardFailReason: quality.hardFailReason,
      }
    }
  }

  if (homemade?.hasTextLayer && homemade.text) {
    const fallback = homemadeEnvelopeFromRaw(homemade, [
      "Used the lightweight parser because the PDF renderer did not return quality-gated text.",
    ])
    if (fallback) return fallback
    const quality = assessExtractionQuality(sanitizeExtractedText(homemade.text).text)
    if (quality.hardFailReason !== "too_short") {
      return {
        status: "failed",
        method: "pdf_text_layer",
        text: "",
        charCount: 0,
        qualityScore: quality.score,
        characterQuality: quality.characterQuality,
        structuralQuality: quality.structuralQuality,
        warnings: [...quality.warnings],
        ocrUsed: false,
        requiresReview: true,
        pages: [],
        pageCount: 0,
        unreadableReason: null,
        hardFailReason: quality.hardFailReason,
      }
    }
  }

  const homemadeReason = homemade?.unreadableReason ?? null
  if (homemadeReason === "encrypted" && (!pdfjsResult.ok || !pdfjsResult.text.trim())) {
    return encryptedEnvelope([TEXT_LAYER_UNREADABLE_MESSAGE.encrypted])
  }

  const reason: PdfUnreadableReason =
    homemadeReason && homemadeReason !== "encrypted" ? homemadeReason : "no_text_found"
  const warning = TEXT_LAYER_UNREADABLE_MESSAGE[reason]
  if (!shouldAttemptOcr(reason)) {
    return {
      status: "requires_ocr",
      method: "pdf_text_layer",
      text: "",
      charCount: 0,
      qualityScore: null,
      characterQuality: null,
      structuralQuality: null,
      warnings: [warning],
      ocrUsed: false,
      requiresReview: true,
      pages: [],
      pageCount: 0,
      unreadableReason: reason,
    }
  }
  return tryOcrFallback(file, reason, [warning], options)
}

/** A .txt file is read verbatim by the browser — genuine, complete text extraction for that one format, still passed through the same sanitize+quality gate for consistency (a .txt file can itself contain stray control bytes). */
export function buildTextFileEnvelope(rawText: string): ExtractionEnvelope {
  return buildGatedTextEnvelope(rawText, "txt_file", "uploaded text file")
}

/** Markdown source is kept (headings/citations survive) and quality-gated the same way as .txt. */
export function buildMarkdownEnvelope(rawText: string): ExtractionEnvelope {
  return buildGatedTextEnvelope(rawText, "markdown", "markdown file")
}

/** Word (.docx) raw text from mammoth — quality-gated like any other machine extraction. */
export function buildDocxEnvelope(rawText: string): ExtractionEnvelope {
  return buildGatedTextEnvelope(rawText, "docx", "Word document")
}

export function buildGatedTextEnvelope(
  rawText: string,
  method: ExtractionMethod,
  sourceLabel: string,
): ExtractionEnvelope {
  const sanitized = sanitizeExtractedText(rawText)
  const quality = assessExtractionQuality(sanitized.text)
  const warnings = [...quality.warnings]
  if (sanitized.removedCount > 0) {
    warnings.push(`Removed ${sanitized.removedCount} unsafe character(s) from the ${sourceLabel}.`)
  }
  if (!quality.passed) {
    return {
      status: quality.hardFailReason === "too_short" ? "pending" : "low_quality",
      method,
      text: sanitized.text,
      charCount: sanitized.text.length,
      qualityScore: quality.score,
      characterQuality: quality.characterQuality,
      structuralQuality: quality.structuralQuality,
      warnings,
      ocrUsed: false,
      requiresReview: true,
      pages: [],
      pageCount: 0,
      unreadableReason: null,
    }
  }
  const status: ExtractionStatus = quality.score >= CLEAN_SCORE_THRESHOLD ? "extracted" : "low_quality"
  return {
    status,
    method,
    text: sanitized.text,
    charCount: sanitized.text.length,
    qualityScore: quality.score,
    characterQuality: quality.characterQuality,
    structuralQuality: quality.structuralQuality,
    warnings,
    ocrUsed: false,
    requiresReview: status !== "extracted",
    pages: [],
    pageCount: 0,
    unreadableReason: null,
  }
}

/** Curator-pasted text still goes through sanitization (clipboard sources are a genuinely different corruption risk — see text-sanitize.ts) but is never quality-gated or auto-scored: a human already read it and chose to paste it, so it is trusted as manually-provided content, not a machine proposal. */
export function buildManualPasteEnvelope(rawText: string): ExtractionEnvelope {
  const sanitized = sanitizeExtractedText(rawText)
  const warnings: string[] = []
  if (sanitized.removedCount > 0) {
    warnings.push(`Removed ${sanitized.removedCount} character(s) that cannot be safely stored from the pasted text.`)
  }
  return {
    status: sanitized.text.trim() ? "extracted" : "pending",
    method: "manual_paste",
    text: sanitized.text,
    charCount: sanitized.text.length,
    qualityScore: null,
    characterQuality: null,
    structuralQuality: null,
    warnings,
    ocrUsed: false,
    requiresReview: false,
    pages: [],
    pageCount: 0,
    unreadableReason: null,
  }
}

export function emptyExtractionEnvelope(): ExtractionEnvelope {
  return pendingEnvelope()
}

/** Public OCR entry point — same envelope the pipeline fallback uses. Dynamically loaded so text-layer-only imports do not pay the Tesseract/pdf.js cost. */
export async function runOcr(file: File): Promise<ExtractionEnvelope> {
  const { runOcr: runOcrEngine } = await import("@/lib/ocr/run-ocr")
  return runOcrEngine(file)
}
