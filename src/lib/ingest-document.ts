/**
 * Single authoritative ingestion entry point for every curator-supplied
 * source: PDF, .txt, Markdown, .docx, images, and pasted text.
 * Callers (Import tab, bulk import) must not branch on file type themselves.
 */

import {
  buildDocxEnvelope,
  buildMarkdownEnvelope,
  buildManualPasteEnvelope,
  buildTextFileEnvelope,
  emptyExtractionEnvelope,
  runPdfExtractionPipeline,
  type ExtractionEnvelope,
  type ExtractionPipelineOptions,
} from "@/lib/extraction-pipeline"
import { isAbortError } from "@/lib/async-timeout"
import { extractDocxText } from "@/lib/docx-text-extraction"
import { classifyIngestSource, ingestKindLabel } from "@/lib/ingest-source"
import { readFileAsText } from "@/lib/legal-extraction"
import { postprocessOcrText } from "@/lib/ocr/postprocess"
import { sanitizeExtractedText } from "@/lib/text-sanitize"
import { assessExtractionQuality, CLEAN_SCORE_THRESHOLD } from "@/lib/extraction-quality"

export { classifyIngestSource, ingestKindLabel, inferStoredMimeType, resolveStoredMimeType, assertFileContentMatchesKind, INGEST_FILE_ACCEPT } from "@/lib/ingest-source"
export type { IngestKind } from "@/lib/ingest-source"

const unsupportedEnvelope = (warning: string): ExtractionEnvelope => ({
  ...emptyExtractionEnvelope(),
  warnings: [warning],
})

const ingestImageFile = async (file: File, options?: ExtractionPipelineOptions): Promise<ExtractionEnvelope> => {
  const { recognizeImage } = await import("@/lib/ocr/engine")
  const bytes = new Uint8Array(await file.arrayBuffer())
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const input = typeof window === "undefined" ? Buffer.from(copy) : new Blob([copy], { type: file.type || "image/png" })
  try {
    const result = await recognizeImage(input, options?.signal)
    const cleaned = postprocessOcrText(result.text)
    const sanitized = sanitizeExtractedText(cleaned)
    const quality = assessExtractionQuality(sanitized.text)
    if (!quality.passed) {
      return {
        status: "requires_ocr",
        method: "ocr",
        text: "",
        charCount: 0,
        qualityScore: quality.score,
        characterQuality: quality.characterQuality,
        structuralQuality: quality.structuralQuality,
        warnings: [
          ...quality.warnings,
          "Text recognition ran on this image but did not produce usable document text. Paste the text to continue.",
        ],
        ocrUsed: true,
        requiresReview: true,
        pages: [],
        pageCount: 0,
        unreadableReason: "no_text_found",
      }
    }
    const status = quality.score >= CLEAN_SCORE_THRESHOLD ? "extracted" : "low_quality"
    return {
      status,
      method: "ocr",
      text: sanitized.text,
      charCount: sanitized.text.length,
      qualityScore: quality.score,
      characterQuality: quality.characterQuality,
      structuralQuality: quality.structuralQuality,
      warnings: [...quality.warnings],
      ocrUsed: true,
      requiresReview: true,
      pages: [{ pageNumber: 1, text: sanitized.text, characterCount: sanitized.text.length }],
      pageCount: 1,
      unreadableReason: null,
    }
  } catch (e) {
    if (isAbortError(e)) throw e
    console.error("Image OCR failed:", e)
    return {
      status: "requires_ocr",
      method: "ocr",
      text: "",
      charCount: 0,
      qualityScore: null,
      characterQuality: null,
      structuralQuality: null,
      warnings: ["Could not recognize text in this image. Paste the text to continue."],
      ocrUsed: true,
      requiresReview: true,
      pages: [],
      pageCount: 0,
      unreadableReason: "no_text_found",
    }
  }
}

export const ingestPastedText = (rawText: string): ExtractionEnvelope => {
  return buildManualPasteEnvelope(rawText)
}

export const ingestDocument = async (
  file: File,
  options?: ExtractionPipelineOptions,
): Promise<ExtractionEnvelope> => {
  const kind = classifyIngestSource(file)

  if (kind === "pdf") return runPdfExtractionPipeline(file, options)

  if (kind === "txt") {
    return buildTextFileEnvelope(await readFileAsText(file))
  }

  if (kind === "markdown") {
    return buildMarkdownEnvelope(await readFileAsText(file))
  }

  if (kind === "docx") {
    try {
      const text = await extractDocxText(await file.arrayBuffer())
      if (!text.trim()) {
        return unsupportedEnvelope(
          "This Word document did not contain extractable text. Paste the text to continue; the original file will still be preserved.",
        )
      }
      return buildDocxEnvelope(text)
    } catch (e) {
      console.error("DOCX extraction failed:", e)
      return unsupportedEnvelope(
        "Could not read this Word document. If it is password-protected or corrupted, paste the text or try a different copy.",
      )
    }
  }

  if (kind === "doc") {
    return {
      ...emptyExtractionEnvelope(),
      warnings: [
        "Word 97–2003 (.doc) files cannot be read automatically. Save the file as .docx, or paste the text below; the original file will still be preserved.",
      ],
    }
  }

  if (kind === "image") {
    return ingestImageFile(file, options)
  }

  return unsupportedEnvelope(
    `Automatic text extraction is not available for this ${ingestKindLabel(kind)}. Paste the text below; the original file will still be preserved.`,
  )
}

export const ingestSuccessToast = (envelope: ExtractionEnvelope): string => {
  if (envelope.ocrUsed) {
    return "Text recognized from the scan or image. Please verify it against the original before publishing."
  }
  if (envelope.method === "txt_file") {
    return "Text read automatically from the plain-text file. Original file will be uploaded and preserved."
  }
  if (envelope.method === "markdown") {
    return "Text read from the Markdown file. Original file will be uploaded and preserved."
  }
  if (envelope.method === "docx") {
    return "Text extracted from the Word document. Original file will be uploaded and preserved."
  }
  if (envelope.status === "extracted") {
    return "Text extracted from the PDF. Citation, case name, and court were proposed below where confidently identified. Review before creating the draft."
  }
  return "Text extracted, but quality checks flagged it as low confidence. Review it carefully before creating the draft."
}
