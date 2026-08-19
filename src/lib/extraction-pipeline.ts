/**
 * Extraction pipeline orchestrator — the single authoritative entry point
 * for "did we get usable text out of this document."
 *
 * Pipeline: raw extraction (pdf-text-extraction.ts text layer) → if that
 * yields nothing usable and the file is not encrypted, OCR fallback
 * (src/lib/ocr/run-ocr.ts: pdf.js rasterize + Tesseract.js, all local) →
 * sanitize (text-sanitize.ts) → quality gate (extraction-quality.ts) →
 * one of five explicit statuses. Nothing downstream of this module should
 * ever treat raw extractor output as authoritative — only an
 * ExtractionEnvelope with status "extracted" or "low_quality" carries
 * text that is safe to propose metadata from or store as searchable text.
 *
 * OCR is attempted only for no_text_found / unsupported_font_encoding /
 * too_short. Encrypted PDFs and quality-failed (wrong-stream) extractions
 * are not sent to OCR. Successful OCR always sets requiresReview: true.
 */

import {
  extractPdfTextLayer,
  isPdfExtractionSupported,
  type PdfPageResult,
  type PdfUnreadableReason,
} from "@/lib/pdf-text-extraction";
import { sanitizeExtractedText } from "@/lib/text-sanitize";
import {
  assessExtractionQuality,
  CLEAN_SCORE_THRESHOLD,
  type QualityBucket,
  type QualityHardFailReason,
} from "@/lib/extraction-quality";

export type ExtractionStatus = "pending" | "extracted" | "low_quality" | "requires_ocr" | "failed";

export type ExtractionMethod =
  | "pdf_text_layer"
  | "txt_file"
  | "markdown"
  | "docx"
  | "manual_paste"
  | "ocr"
  | "none"

export interface ExtractionEnvelope {
  status: ExtractionStatus;
  method: ExtractionMethod;
  /** Sanitized, quality-gated text. Empty string whenever status is "requires_ocr" or "failed" — never populated with unvetted text, even partially. */
  text: string;
  /** Character count of `text` (0 when text is withheld). Diagnostic only. */
  charCount: number;
  /** 0-1, or null when no quality assessment ran (e.g. no text layer was found at all). Not shown to the curator as a precise number. */
  qualityScore: number | null;
  /** Section 7: character quality and structural quality shown as separate, coarse, plain-language signals — never a raw percentage. `null` when no quality assessment ran. */
  characterQuality: QualityBucket | null;
  structuralQuality: QualityBucket | null;
  warnings: string[];
  ocrUsed: boolean;
  /** True whenever status is anything other than "extracted" — the Review Queue uses this to prompt closer curator attention, independent of the publication-validation gate. */
  requiresReview: boolean;
  /** Set only when status is "failed" — the specific reason `assessExtractionQuality` rejected the text (see QualityHardFailReason), so a UI can show a plain-language explanation instead of one generic "extraction failed" message. `undefined`/`null` for every other status. */
  hardFailReason?: QualityHardFailReason | null;
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
  pages: PdfPageResult[];
  pageCount: number;
  /** SIMPLE AND TIGHT ingestion pass: why nothing usable was extracted, when applicable (see PdfUnreadableReason) — lets a UI show a specific, honest, plain-language reason ("This PDF is protected"/"Uses a font we can't read yet"/"Looks like a scanned document") instead of one generic "OCR required" message for every case. `null` whenever status is "extracted"/"low_quality"/"pending", or for non-PDF methods. */
  unreadableReason: PdfUnreadableReason | null;
}

const TEXT_LAYER_UNREADABLE_MESSAGE: Record<PdfUnreadableReason, string> = {
  encrypted:
    "This PDF is protected/encrypted, so its text could not be read automatically. If you have an unprotected copy, try uploading that instead — otherwise paste the text manually.",
  unsupported_font_encoding:
    "This PDF has a text layer, but uses an embedded font encoding the lightweight parser cannot decode. Trying the full PDF renderer, then text recognition if needed.",
  no_text_found:
    "The lightweight parser found no usable text layer. Trying the full PDF renderer, then text recognition if this is a scan.",
}

const shouldAttemptOcr = (reason: PdfUnreadableReason | null): boolean => {
  return reason === "no_text_found"
}

/** pdf.js must recover at least this much more text than the stream scan before it becomes the text layer of record. */
export const PDFJS_FULLER_TEXT_RATIO = 1.25

/**
 * The homemade parser is a stream scan, not a page tree. Prefer pdf.js
 * whenever it returns substantially more quality-gated text (typical of
 * multi-stream WIR reports).
 */
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

const tryPdfjsTextThenOcr = async (
  file: File,
  priorReason: PdfUnreadableReason | null,
  priorWarnings: string[],
  options?: ExtractionPipelineOptions,
): Promise<ExtractionEnvelope> => {
  try {
    const { extractPdfjsTextContent } = await import("@/lib/ocr/rasterize-pdf")
    const recovered = await extractPdfjsTextContent(file)
    if (recovered?.text) {
      const envelope = envelopeFromSanitizedText(recovered.text, recovered.pages, "pdf_text_layer", [
        ...priorWarnings,
        "Text recovered via the PDF renderer (embedded font encoding the lightweight parser cannot decode).",
      ])
      if (envelope) return envelope
    }
  } catch (e) {
    console.error("pdf.js text-layer recovery failed:", e)
  }
  return tryOcrFallback(file, priorReason, priorWarnings, options)
}

const tryOcrFallback = async (
  file: File,
  priorReason: PdfUnreadableReason | null,
  priorWarnings: string[],
  options?: ExtractionPipelineOptions,
): Promise<ExtractionEnvelope> => {
  try {
    const { runOcr: runOcrEngine } = await import("@/lib/ocr/run-ocr")
    const ocr = await runOcrEngine(file, {
      onProgress: options?.onOcrProgress
        ? (page, total) => options.onOcrProgress?.({ page, total, phase: "ocr" })
        : undefined,
      maxPages: options?.maxOcrPages,
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
  };
}

/**
 * Runs the full pipeline against a PDF File. Never throws for a normal
 * (even totally unusable) PDF — every failure mode is communicated via
 * `status`, not an exception.
 */
export async function runPdfExtractionPipeline(
  file: File,
  options?: ExtractionPipelineOptions,
): Promise<ExtractionEnvelope> {
  if (!isPdfExtractionSupported()) {
    return {
      status: "requires_ocr",
      method: "none",
      text: "",
      charCount: 0,
      qualityScore: null,
      characterQuality: null,
      structuralQuality: null,
      warnings: ["This browser does not support automatic PDF text extraction (Web Compression Streams API unavailable)."],
      ocrUsed: false,
      requiresReview: true,
      pages: [],
      pageCount: 0,
      unreadableReason: null,
    };
  }

  let raw;
  try {
    raw = await extractPdfTextLayer(file);
  } catch (e) {
    // Deliberately does not interpolate the raw parser exception into the
    // user-facing warning -- that's internal pdf.js/parser detail, not a
    // safe explanation (Section 38). Log it for debugging instead.
    console.error("PDF text-layer extraction threw an unexpected error:", e);
    return {
      status: "failed",
      method: "pdf_text_layer",
      text: "",
      charCount: 0,
      qualityScore: null,
      characterQuality: null,
      structuralQuality: null,
      warnings: ["Could not process this PDF — the file may be corrupted or use an unsupported internal format."],
      ocrUsed: false,
      requiresReview: true,
      pages: [],
      pageCount: 0,
      unreadableReason: null,
    };
  }

  if (!raw.hasTextLayer || !raw.text) {
    const reason = raw.unreadableReason ?? "no_text_found"
    const warning = TEXT_LAYER_UNREADABLE_MESSAGE[reason]
    if (reason === "encrypted") {
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
    if (reason === "unsupported_font_encoding") {
      return tryPdfjsTextThenOcr(file, reason, [warning], options)
    }
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
    // WIR / CID-font reports often look like "no text" to the lightweight
    // parser even though pdf.js can read a real text layer. Try that
    // before raster OCR — same recovery path as unsupported_font_encoding.
    return tryPdfjsTextThenOcr(file, reason, [warning], options)
  }

  const sanitized = sanitizeExtractedText(raw.text);
  const quality = assessExtractionQuality(sanitized.text);
  const warnings = [...quality.warnings];
  if (sanitized.removedCount > 0) {
    const parts: string[] = [];
    if (sanitized.hadNulBytes) parts.push("NUL bytes");
    if (sanitized.hadInvalidSurrogates) parts.push("invalid surrogate sequences");
    if (sanitized.hadOtherControlChars) parts.push("control characters");
    warnings.push(
      `Removed ${sanitized.removedCount} character(s) that cannot be safely stored (${parts.join(", ")}) — likely a sign the source stream was not genuine document text.`,
    );
  }

  if (!quality.passed) {
    // Boilerplate / garbage: something was extracted but it is not
    // judgment content — OCR the rendered page would often just reread
    // the same wrong stream, so we do not fall through. too_short: almost
    // nothing usable came from the text layer; OCR may recover a scan.
    if (quality.hardFailReason === "too_short") {
      return tryPdfjsTextThenOcr(file, "no_text_found", warnings, options)
    }
    return {
      status: "failed",
      method: "pdf_text_layer",
      text: "",
      charCount: 0,
      qualityScore: quality.score,
      characterQuality: quality.characterQuality,
      structuralQuality: quality.structuralQuality,
      warnings,
      ocrUsed: false,
      requiresReview: true,
      pages: [],
      pageCount: 0,
      unreadableReason: null,
      hardFailReason: quality.hardFailReason,
    }
  }

  const status: ExtractionStatus = quality.score >= CLEAN_SCORE_THRESHOLD ? "extracted" : "low_quality";
  // Each page's own text is sanitized the same way as the full text — a
  // page carrying unsafe bytes must not leak them just because the
  // DOCUMENT-level sanitized text happened to look fine overall.
  const pages: PdfPageResult[] = raw.pages.map((p) => {
    const pageSanitized = sanitizeExtractedText(p.text);
    return { pageNumber: p.pageNumber, text: pageSanitized.text, characterCount: pageSanitized.text.length };
  });
  const homemade = {
    status,
    method: "pdf_text_layer" as const,
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
  };
  // The lightweight stream scan often catches only the first content
  // stream. pdf.js walks the page tree and is the fuller text layer when
  // it returns substantially more (typical of WIR two-column reports).
  try {
    const { extractPdfjsTextContent } = await import("@/lib/ocr/rasterize-pdf");
    const recovered = await extractPdfjsTextContent(file);
    if (recovered?.text && shouldPreferPdfjsText(sanitized.text.length, recovered.text.length)) {
      const better = envelopeFromSanitizedText(recovered.text, recovered.pages, "pdf_text_layer", [
        ...warnings,
        "Used the full PDF renderer’s text layer — it recovered more of the document than the lightweight parser.",
      ]);
      if (better) return better;
    }
  } catch (e) {
    console.error("pdf.js fuller-text upgrade failed:", e);
  }
  return homemade;
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
  const sanitized = sanitizeExtractedText(rawText);
  const warnings: string[] = [];
  if (sanitized.removedCount > 0) {
    warnings.push(`Removed ${sanitized.removedCount} character(s) that cannot be safely stored from the pasted text.`);
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
  };
}

export function emptyExtractionEnvelope(): ExtractionEnvelope {
  return pendingEnvelope();
}

/** Public OCR entry point — same envelope the pipeline fallback uses. Dynamically loaded so text-layer-only imports do not pay the Tesseract/pdf.js cost. */
export async function runOcr(file: File): Promise<ExtractionEnvelope> {
  const { runOcr: runOcrEngine } = await import("@/lib/ocr/run-ocr")
  return runOcrEngine(file)
}
