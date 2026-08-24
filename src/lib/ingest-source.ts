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

const startsWithBytes = (bytes: Uint8Array, signature: number[]): boolean =>
  signature.every((value, index) => bytes[index] === value)

const asciiAt = (bytes: Uint8Array, offset: number, ascii: string): boolean => {
  for (let i = 0; i < ascii.length; i += 1) {
    if (bytes[offset + i] !== ascii.charCodeAt(i)) return false
  }
  return true
}

const isPdfMagic = (bytes: Uint8Array): boolean => {
  const limit = Math.min(bytes.length, 1024)
  for (let i = 0; i <= limit - 4; i += 1) {
    if (asciiAt(bytes, i, "%PDF")) return true
  }
  return false
}

const isPngMagic = (bytes: Uint8Array): boolean =>
  startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const isJpegMagic = (bytes: Uint8Array): boolean =>
  bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff

const isWebpMagic = (bytes: Uint8Array): boolean =>
  asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WEBP")

const isZipMagic = (bytes: Uint8Array): boolean =>
  bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)

const isOleMagic = (bytes: Uint8Array): boolean =>
  startsWithBytes(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])

const isExecutableMagic = (bytes: Uint8Array): boolean =>
  (bytes[0] === 0x4d && bytes[1] === 0x5a) ||
  (bytes[0] === 0x7f && asciiAt(bytes, 1, "ELF"))

export type SniffedMime =
  | "application/pdf"
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  | "application/msword"
  | null

export const sniffMagicMime = (bytes: Uint8Array): SniffedMime => {
  if (isPdfMagic(bytes)) return "application/pdf"
  if (isPngMagic(bytes)) return "image/png"
  if (isJpegMagic(bytes)) return "image/jpeg"
  if (isWebpMagic(bytes)) return "image/webp"
  if (isZipMagic(bytes)) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  if (isOleMagic(bytes)) return "application/msword"
  return null
}

const CONTENT_MISMATCH = "This file's contents do not match its type. Upload was blocked."

/**
 * Reject executables and files whose bytes do not match the declared kind.
 * Text/Markdown only reject executable signatures so legal notes stay valid.
 */
export const assertFileContentMatchesKind = async (file: { name: string; type?: string | null; slice: File["slice"] }): Promise<void> => {
  const header = new Uint8Array(await file.slice(0, 1024).arrayBuffer())
  if (header.length === 0) throw new Error("File is empty.")
  if (isExecutableMagic(header)) throw new Error(CONTENT_MISMATCH)

  const kind = classifyIngestSource(file)
  const sniffed = sniffMagicMime(header)

  switch (kind) {
    case "pdf":
      if (sniffed !== "application/pdf") throw new Error(CONTENT_MISMATCH)
      return
    case "image": {
      const name = file.name.toLowerCase()
      const mime = (file.type ?? "").toLowerCase()
      const expectPng = name.endsWith(".png") || mime === "image/png"
      const expectWebp = name.endsWith(".webp") || mime === "image/webp"
      const expectJpeg = name.endsWith(".jpg") || name.endsWith(".jpeg") || mime === "image/jpeg" || mime === "image/jpg"
      if (expectPng && sniffed !== "image/png") throw new Error(CONTENT_MISMATCH)
      if (expectWebp && sniffed !== "image/webp") throw new Error(CONTENT_MISMATCH)
      if (expectJpeg && sniffed !== "image/jpeg") throw new Error(CONTENT_MISMATCH)
      if (!expectPng && !expectWebp && !expectJpeg && sniffed !== "image/png" && sniffed !== "image/jpeg" && sniffed !== "image/webp") {
        throw new Error(CONTENT_MISMATCH)
      }
      return
    }
    case "docx":
      if (sniffed !== "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
        throw new Error(CONTENT_MISMATCH)
      }
      return
    case "doc":
      if (sniffed !== "application/msword") throw new Error(CONTENT_MISMATCH)
      return
    case "txt":
    case "markdown":
      return
    default:
      throw new Error(CONTENT_MISMATCH)
  }
}

/** Prefer magic-byte MIME when present so Storage metadata matches contents. */
export const resolveStoredMimeType = async (file: File): Promise<string> => {
  await assertFileContentMatchesKind(file)
  const header = new Uint8Array(await file.slice(0, 1024).arrayBuffer())
  const sniffed = sniffMagicMime(header)
  if (sniffed === "image/png" || sniffed === "image/jpeg" || sniffed === "image/webp" || sniffed === "application/pdf") {
    return sniffed
  }
  return inferStoredMimeType(file)
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
