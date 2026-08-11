/**
 * Central place that decides how a `documents` row can be shown in the
 * in-app viewer (`document-viewer-dialog.tsx`), shared by every
 * DocumentsPanel consumer (Docket Matter, Judgment, Case Law, Quick
 * Code, Bench Note).
 *
 * There is no `preview_path`/`preview_mime_type` column on `documents`
 * today, and no server-side conversion infrastructure exists in this
 * project (no Supabase Edge Functions are deployed — confirmed live via
 * `list_edge_functions`, zero results). So today this only classifies
 * the ORIGINAL uploaded file's own `mime_type`: PDFs and images preview
 * directly; everything else (Word documents included) is "unsupported"
 * and falls back to Download Original.
 *
 * If a future migration adds a preview-derivative column, this is the
 * one function that should change to prefer it — e.g. check
 * `doc.preview_mime_type ?? doc.mime_type` — without the viewer or panel
 * components needing to know the difference.
 */
export type DocumentPreviewKind = "pdf" | "image" | "unsupported";

const PDF_MIME = "application/pdf";
const IMAGE_MIME_PREFIX = "image/";

const WORD_MIME_TYPES = new Set([
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export function getDocumentPreviewKind(
  mimeType: string | null | undefined,
): DocumentPreviewKind {
  if (!mimeType) return "unsupported";
  if (mimeType === PDF_MIME) return "pdf";
  if (mimeType.startsWith(IMAGE_MIME_PREFIX)) return "image";
  return "unsupported";
}

export function isWordDocument(
  mimeType: string | null | undefined,
  fileName: string,
): boolean {
  if (mimeType && WORD_MIME_TYPES.has(mimeType)) return true;
  return /\.docx?$/i.test(fileName);
}
