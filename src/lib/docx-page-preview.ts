/**
 * Faithful, page-based .docx preview via docx-preview (renders real page
 * geometry, fonts, headings, spacing, indentation, margins, page breaks,
 * headers/footers, footnotes/endnotes, tables, lists, images, and
 * alignment straight from the document's own OOXML) — a fundamentally
 * different, higher-fidelity rendering path than mammoth's semantic-HTML
 * text extraction (docx-text-extraction.ts), which is deliberately left
 * untouched and still used for full-text search indexing on ingestion.
 *
 * Fully client-side (this app has no server compute — see the deployment
 * survey behind this module's introduction); the source .docx never
 * leaves the browser. Output is meant to be generated once and cached as a
 * `documents` preview-derivative row (see use-documents.ts) rather than
 * re-rendered on every open.
 */
import { renderAsync } from "docx-preview"
import DOMPurify from "dompurify"
import { sanitizeDocxPageBody, sanitizeDocxPageStyle } from "@/lib/docx-page-preview-sanitize"

const DOCX_PREVIEW_OPTIONS = {
  inWrapper: true,
  ignoreWidth: false,
  ignoreHeight: false,
  ignoreFonts: false,
  breakPages: true,
  experimental: true,
  useBase64URL: true,
  renderHeaders: true,
  renderFooters: true,
  renderFootnotes: true,
  renderEndnotes: true,
  className: "docx-page",
} as const

/**
 * Renders a .docx ArrayBuffer into a sanitized, self-contained HTML
 * fragment (a `<style>` block plus the paginated body markup) suitable for
 * caching and for display inside a sandboxed `srcDoc` iframe. Every
 * embedded image/font is inlined as a `data:` URL (`useBase64URL`), so the
 * fragment carries no external references at all.
 *
 * Note on fidelity: docx-preview maps each run's declared font-family onto
 * the VIEWING browser's own font stack — it does not extract/embed actual
 * font FILES from the .docx (OOXML rarely embeds them anyway). Because
 * this output is cached and reused by every subsequent viewer, the fonts
 * available in whichever browser generates the derivative are what
 * everyone else sees baked in. This is the same font-substitution
 * behavior a browser already exhibits for any web page, and is disclosed
 * as a known limitation rather than silently accepted as "faithful."
 */
export async function renderDocxToPageSnapshot(buffer: ArrayBuffer): Promise<string> {
  const bodyContainer = document.createElement("div")
  const styleContainer = document.createElement("div")
  await renderAsync(buffer, bodyContainer, styleContainer, DOCX_PREVIEW_OPTIONS)

  const safeStyle = sanitizeDocxPageStyle(styleContainer.innerHTML, DOMPurify)
  const safeBody = sanitizeDocxPageBody(bodyContainer.innerHTML, DOMPurify)

  return `${safeStyle}<div class="docx-page-snapshot">${safeBody}</div>`
}
