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

import { extractPdfTextLayer, isPdfExtractionSupported } from "@/lib/pdf-text-extraction";
import { sanitizeExtractedText } from "@/lib/text-sanitize";
import { assessExtractionQuality, CLEAN_SCORE_THRESHOLD } from "@/lib/extraction-quality";

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
  warnings: string[];
  ocrUsed: boolean;
  /** True whenever status is anything other than "extracted" — the Review Queue uses this to prompt closer curator attention, independent of the publication-validation gate. */
  requiresReview: boolean;
}

function pendingEnvelope(): ExtractionEnvelope {
  return {
    status: "pending",
    method: "none",
    text: "",
    charCount: 0,
    qualityScore: null,
    warnings: [],
    ocrUsed: false,
    requiresReview: true,
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
      warnings: ["This browser does not support automatic PDF text extraction (Web Compression Streams API unavailable)."],
      ocrUsed: false,
      requiresReview: true,
    };
  }

  let raw;
  try {
    raw = await extractPdfTextLayer(file);
  } catch (e) {
    return {
      status: "failed",
      method: "pdf_text_layer",
      text: "",
      charCount: 0,
      qualityScore: null,
      warnings: [`PDF extraction threw an unexpected error: ${e instanceof Error ? e.message : String(e)}`],
      ocrUsed: false,
      requiresReview: true,
    };
  }

  if (!raw.hasTextLayer || !raw.text) {
    return {
      status: "requires_ocr",
      method: "pdf_text_layer",
      text: "",
      charCount: 0,
      qualityScore: null,
      warnings: [
        "No extractable text layer was found — this is likely a scanned/image-only document, or uses a font encoding this parser cannot resolve. OCR is required but not available in this build.",
      ],
      ocrUsed: false,
      requiresReview: true,
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
      warnings,
      ocrUsed: false,
      requiresReview: true,
    };
  }

  const status: ExtractionStatus = quality.score >= CLEAN_SCORE_THRESHOLD ? "extracted" : "low_quality";
  return {
    status,
    method: "pdf_text_layer",
    text: sanitized.text,
    charCount: sanitized.text.length,
    qualityScore: quality.score,
    warnings,
    ocrUsed: false,
    requiresReview: status !== "extracted",
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
      warnings,
      ocrUsed: false,
      requiresReview: true,
    };
  }
  const status: ExtractionStatus = quality.score >= CLEAN_SCORE_THRESHOLD ? "extracted" : "low_quality";
  return {
    status,
    method: "txt_file",
    text: sanitized.text,
    charCount: sanitized.text.length,
    qualityScore: quality.score,
    warnings,
    ocrUsed: false,
    requiresReview: status !== "extracted",
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
    warnings,
    ocrUsed: false,
    requiresReview: false,
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
    warnings: ["OCR is not implemented in this build. No OCR engine or service is installed, configured, or reachable."],
    ocrUsed: false,
    requiresReview: true,
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
