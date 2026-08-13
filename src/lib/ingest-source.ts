/**
 * Classify an uploaded file for ingestion and in-app preview.
 * Extension wins when the browser leaves `file.type` empty (common for .md).
 */

export type IngestKind = "pdf" | "txt" | "markdown" | "docx" | "doc" | "image" | "unsupported"

export const INGEST_FILE_ACCEPT = ".pdf,.txt,.md,.markdown,.docx,.doc,image/png,image/jpeg,image/webp"

const IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/jpg"])

export const classifyIngestSource = (file: { name: string; type?: string | null }): IngestKind => {
  const name = file.name.toLowerCase()
  const mime = (file.type ?? "").toLowerCase()

  // Extension first: browsers often report .md as text/plain or leave type empty.
  if (name.endsWith(".pdf") || mime === "application/pdf") return "pdf"
  if (name.endsWith(".md") || name.endsWith(".markdown") || mime === "text/markdown" || mime === "text/x-markdown") {
    return "markdown"
  }
  if (name.endsWith(".docx") || mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return "docx"
  }
  if (name.endsWith(".doc") || mime === "application/msword") return "doc"
  if (name.endsWith(".txt") || mime === "text/plain") return "txt"
  if (IMAGE_MIME.has(mime) || /\.(png|jpe?g|webp)$/i.test(name)) return "image"
  return "unsupported"
}

/** MIME stored on `documents` and sent to Storage so empty browser types still match the bucket allow-list. */
export const inferStoredMimeType = (file: { name: string; type?: string | null }): string => {
  const kind = classifyIngestSource(file)
  switch (kind) {
    case "pdf":
      return "application/pdf"
    case "txt":
      return "text/plain"
    case "markdown":
      return "text/markdown"
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    case "doc":
      return "application/msword"
    case "image": {
      const mime = (file.type ?? "").toLowerCase()
      if (mime === "image/jpg") return "image/jpeg"
      if (IMAGE_MIME.has(mime)) return mime
      const name = file.name.toLowerCase()
      if (name.endsWith(".png")) return "image/png"
      if (name.endsWith(".webp")) return "image/webp"
      return "image/jpeg"
    }
    default:
      return (file.type && file.type !== "") ? file.type : "application/octet-stream"
  }
}

export const ingestKindLabel = (kind: IngestKind): string => {
  switch (kind) {
    case "pdf":
      return "PDF"
    case "txt":
      return "plain text"
    case "markdown":
      return "Markdown"
    case "docx":
      return "Word document"
    case "doc":
      return "legacy Word document"
    case "image":
      return "image"
    default:
      return "file"
  }
}
