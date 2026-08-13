/**
 * Extraction pipeline orchestrator — the single authoritative entry point
 * for "did we get usable text out of this document," and the
 * abstraction/interface Phase 6 of the holistic ingestion repair asks
 * for: "isolate the current browser fallback behind that interface" so a
 * future server-side/OCR extraction worker can be swapped in without
 * touching any calling UI code.
 *
 * Pipeline: raw extraction (pdf-text-extraction.ts, best-effort, browser-
 * only) → sanitize (text-sanitize.ts, removes what Postgres/JSON cannot
 * store) → quality gate (extraction-quality.ts, document-agnostic) →
 * one of five explicit statuses. Nothing downstream of this module should
 * ever treat raw extractor output as authoritative — only an
 * ExtractionEnvelope with status "extracted" or "low_quality" carries
 * text that is safe to propose metadata from or store as searchable text.
 *
 * HONESTY BOUNDARY: there is exactly one extraction engine implemented in
 * this build — `extractPdfTextLayer` (src/lib/pdf-text-extraction.ts), a
 * dependency-free browser-native parser, because no PDF library (pdfjs-
 * dist or similar) can be installed in this project's sandbox (npm
 * registry returns 403 — verified again this pass) and there is no OCR
 * service configured or reachable. `runOcr` below is NOT implemented — it
 * always returns an "unavailable" result rather than fabricating a
 * result. See PIPELINE ARCHITECTURE NOTES at the bottom of this file for
 * exactly what a future server-side worker would need to implement to
 * replace it.
 */

import {
  extractPdfTextLayer,
  isPdfExtractionSupported,
  type PdfPageResult,
  type PdfUnreadableReason,
} from "@/lib/pdf-text-extraction";
import { sanitizeExtractedText } from "@/lib/text-sanitize";
import { assessExtractionQuality, CLEAN_SCORE_THRESHOLD, type QualityBucket } from "@/lib/extraction-quality";

export type ExtractionStatus = "pending" | "extracted" | "low_quality" | "requires_ocr" | "failed";

export type ExtractionMethod = "pdf_text_layer" | "txt_file" | "manual_paste" | "ocr" | "none";

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
export async function runPdfExtractionPipeline(file: File): Promise<ExtractionEnvelope> {
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
    // SIMPLE AND TIGHT ingestion pass: raw.unreadableReason distinguishes
    // WHY nothing was extracted (see pdf-text-extraction.ts) so the
    // curator gets an honest, specific, plain-language reason instead of
    // one generic message for "genuinely scanned," "encrypted," and
    // "uses a font this parser can't decode" alike — three different
    // situations with different implications for what to do next.
    const reasonMessage: Record<PdfUnreadableReason, string> = {
      encrypted:
        "This PDF is protected/encrypted, so its text could not be read automatically. If you have an unprotected copy, try uploading that instead — otherwise paste the text manually.",
      unsupported_font_encoding:
        "This PDF has a text layer, but uses an embedded font encoding this parser cannot decode yet. The original file has been preserved — paste the text manually, or try a different copy of the same document if one is available.",
      no_text_found:
        "No extractable text layer was found — this looks like a scanned/image document. The original file has been preserved, but reliable text could not be extracted automatically.",
    };
    return {
      status: "requires_ocr",
      method: "pdf_text_layer",
      text: "",
      charCount: 0,
      qualityScore: null,
      characterQuality: null,
      structuralQuality: null,
      warnings: [reasonMessage[raw.unreadableReason ?? "no_text_found"]],
      ocrUsed: false,
      requiresReview: true,
      pages: [],
      pageCount: 0,
      unreadableReason: raw.unreadableReason,
    };
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
    // "boilerplate" and "printable_ratio"/"replacement_chars"/"control_chars"
    // mean SOMETHING was confidently extracted, it's just clearly not
    // judgment content (font/license metadata, PDF-internal binary) —
    // that's "failed", not "requires_ocr" (OCR wouldn't help; the wrong
    // stream was read, not an absent text layer). "too_short" means
    // almost nothing usable came out at all, which reads more like a
    // missing/unusable text layer.
    const status: ExtractionStatus = quality.hardFailReason === "too_short" ? "requires_ocr" : "failed";
    return {
      status,
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
      unreadableReason: status === "requires_ocr" ? "no_text_found" : null,
    };
  }

  const status: ExtractionStatus = quality.score >= CLEAN_SCORE_THRESHOLD ? "extracted" : "low_quality";
  // Each page's own text is sanitized the same way as the full text — a
  // page carrying unsafe bytes must not leak them just because the
  // DOCUMENT-level sanitized text happened to look fine overall.
  const pages: PdfPageResult[] = raw.pages.map((p) => {
    const pageSanitized = sanitizeExtractedText(p.text);
    return { pageNumber: p.pageNumber, text: pageSanitized.text, characterCount: pageSanitized.text.length };
  });
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
  };
}

/** A .txt file is read verbatim by the browser — genuine, complete text extraction for that one format, still passed through the same sanitize+quality gate for consistency (a .txt file can itself contain stray control bytes). */
export function buildTextFileEnvelope(rawText: string): ExtractionEnvelope {
  const sanitized = sanitizeExtractedText(rawText);
  const quality = assessExtractionQuality(sanitized.text);
  const warnings = [...quality.warnings];
  if (sanitized.removedCount > 0) warnings.push(`Removed ${sanitized.removedCount} unsafe character(s) from the uploaded text file.`);
  if (!quality.passed) {
    return {
      status: quality.hardFailReason === "too_short" ? "pending" : "low_quality",
      method: "txt_file",
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
    };
  }
  const status: ExtractionStatus = quality.score >= CLEAN_SCORE_THRESHOLD ? "extracted" : "low_quality";
  return {
    status,
    method: "txt_file",
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
  };
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

/**
 * OCR entry point — deliberately NOT implemented. Always returns an
 * honest "unavailable" envelope rather than fabricating recognized text.
 * See PIPELINE ARCHITECTURE NOTES below for what a real implementation
 * needs.
 */
export async function runOcr(_file: File): Promise<ExtractionEnvelope> {
  return {
    status: "requires_ocr",
    method: "none",
    text: "",
    charCount: 0,
    qualityScore: null,
    characterQuality: null,
    structuralQuality: null,
    warnings: ["OCR is not implemented in this build. No OCR engine or service is installed, configured, or reachable."],
    ocrUsed: false,
    requiresReview: true,
    pages: [],
    pageCount: 0,
    unreadableReason: null,
  };
}

// -----------------------------------------------------------------------
// PIPELINE ARCHITECTURE NOTES — what a future server/Edge Function worker
// needs to implement to replace the browser-only path above without any
// caller (ImportTab, the Review Queue, use-import-jobs.ts) changing:
//
//   1. Accept the original file (already uploaded to the private
//      `documents` Storage bucket by the time a draft exists — see
//      uploadDocumentToEntity in use-documents.ts) and return an
//      ExtractionEnvelope shaped exactly as above.
//   2. For a mature PDF text-layer parser: a real object-graph-aware
//      library (e.g. pdfjs-dist, or a server-side tool like `pdftotext`
//      from Poppler) would remove essentially every limitation
//      documented in pdf-text-extraction.ts's header (no ToUnicode CMap
//      resolution, no true page/Contents graph, heuristic-only stream
//      classification). This requires either (a) npm registry access to
//      install a JS library, or (b) a server/Edge Function environment
//      with a native PDF toolchain available — neither exists in this
//      project's sandbox as of this pass (verified: `npm install
//      pdfjs-dist` returns 403 Forbidden).
//   3. For OCR: a real OCR engine or hosted OCR API (Tesseract, a cloud
//      vision/document-AI service, etc.) is required — none is installed
//      or configured. `runOcr` above is the exact function to implement
//      against once one is available; every caller already treats its
//      return value as just another ExtractionEnvelope.
//   4. Whichever engine is used, it MUST still be run through
//      sanitizeExtractedText + assessExtractionQuality before being
//      trusted — those two gates are engine-agnostic and should not be
//      bypassed just because a "better" engine produced the raw text.
// -----------------------------------------------------------------------
