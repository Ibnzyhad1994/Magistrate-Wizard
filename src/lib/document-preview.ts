/**
 * Central place that decides how a `documents` row can be shown in the
 * in-app viewer (`document-viewer-dialog.tsx`), shared by every
 * DocumentsPanel consumer.
 *
 * Preview is client-side: PDFs and images render natively; plain text and
 * Markdown are fetched and displayed; .docx is converted locally with
 * mammoth. Legacy .doc has no browser parser — download only.
 */

export type DocumentPreviewKind = "pdf" | "image" | "text" | "markdown" | "docx" | "unsupported"

const PDF_MIME = "application/pdf"
const IMAGE_MIME_PREFIX = "image/"

const WORD_MIME_TYPES = new Set([
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
])

const TEXT_MIME_TYPES = new Set(["text/plain", "text/csv"])
const MARKDOWN_MIME_TYPES = new Set(["text/markdown", "text/x-markdown"])
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

export const getDocumentPreviewKind = (
  mimeType: string | null | undefined,
  fileName?: string,
): DocumentPreviewKind => {
  const name = (fileName ?? "").toLowerCase()
  const mime = (mimeType ?? "").toLowerCase()

  if (mime === PDF_MIME || name.endsWith(".pdf")) return "pdf"
  if (mime.startsWith(IMAGE_MIME_PREFIX) || /\.(png|jpe?g|webp|gif)$/i.test(name)) return "image"
  if (MARKDOWN_MIME_TYPES.has(mime) || name.endsWith(".md") || name.endsWith(".markdown")) return "markdown"
  if (mime === DOCX_MIME || name.endsWith(".docx")) return "docx"
  if (TEXT_MIME_TYPES.has(mime) || name.endsWith(".txt")) return "text"
  return "unsupported"
}

export const isWordDocument = (mimeType: string | null | undefined, fileName: string): boolean => {
  if (mimeType && WORD_MIME_TYPES.has(mimeType)) return true
  return /\.docx?$/i.test(fileName)
}

export const isLegacyWordDocument = (mimeType: string | null | undefined, fileName: string): boolean => {
  if (mimeType === "application/msword") return true
  return /\.doc$/i.test(fileName) && !/\.docx$/i.test(fileName)
}
