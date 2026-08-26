/**
 * Strip tags/attributes that must never reach the in-app viewer.
 * Mammoth and the markdown renderer only emit a small tag set; this is
 * defense in depth against a crafted .docx/.md, not a general HTML sanitizer.
 */

const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "div",
  "span",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "code",
  "a",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "hr",
])

export const escapeHtml = (text: string): string => {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

const decodeHtmlEntitiesOnce = (value: string): string => {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = parseInt(hex, 16)
      return Number.isFinite(code) ? String.fromCodePoint(code) : ""
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number(dec)
      return Number.isFinite(code) ? String.fromCodePoint(code) : ""
    })
}

const decodeHtmlEntities = (value: string): string => {
  let current = value
  for (let i = 0; i < 3; i += 1) {
    const next = decodeHtmlEntitiesOnce(current)
    if (next === current) break
    current = next
  }
  return current
}

/** True only for http(s), mailto, and in-page fragments. */
export const isSafeHref = (href: string): boolean => {
  const trimmed = decodeHtmlEntities(href)
    .trim()
    .replace(/[\u0000-\u001F\u007F]/g, "")
  if (!trimmed) return false
  if (trimmed.startsWith("#") && !trimmed.includes(":")) return true
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return false
  }
  return parsed.protocol === "https:" || parsed.protocol === "http:" || parsed.protocol === "mailto:"
}

const dropDangerousBlocks = (html: string): string => {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<script[\s\S]*$/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<style[\s\S]*$/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<textarea[\s\S]*?<\/textarea>/gi, "")
    .replace(/<xmp[\s\S]*?<\/xmp>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object[\s\S]*?<\/object>/gi, "")
}

const rewriteTag = (full: string, tag: string, attrs: string): string => {
  const closing = full.startsWith("</")
  const name = tag.toLowerCase()
  if (!ALLOWED_TAGS.has(name)) return ""
  if (closing) return `</${name}>`
  if (name === "br" || name === "hr") return `<${name} />`
  if (name === "a") {
    const hrefMatch = attrs.match(/\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>/]+))/i)
    const href = hrefMatch?.[2] ?? hrefMatch?.[3] ?? hrefMatch?.[4] ?? ""
    if (!href || !isSafeHref(href)) return "<a>"
    return `<a href="${escapeHtml(decodeHtmlEntities(href).trim())}" rel="noopener noreferrer" target="_blank">`
  }
  return `<${name}>`
}

/**
 * Allowlist tags. Attributes are stripped except a safe `href` on `<a>`.
 * Matches `<tag …>`, `<tag/>`, and shorthand `<tag/attr=…>` so SVG/JS
 * bypasses that skip a whitespace-required attribute group cannot pass.
 */
export const sanitizePreviewHtml = (html: string): string => {
  return dropDangerousBlocks(html).replace(
    /<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g,
    (full, tag: string, attrs: string) => rewriteTag(full, tag, attrs ?? ""),
  )
}

const PREVIEW_SRCDOC_STYLES = [
  "html{color-scheme:dark;background:transparent}",
  "body{margin:0;padding:1.5rem;font:14px/1.6 system-ui,sans-serif;color:CanvasText;background:transparent}",
  "a{color:#93c5fd}",
  "blockquote{border-left:2px solid #444;padding-left:0.75rem;font-style:italic}",
  "code{background:#222;padding:0.1em 0.3em;border-radius:3px}",
  "pre{overflow:auto;background:#222;padding:0.75rem;border-radius:6px}",
  "table{width:100%;border-collapse:collapse}",
  "th,td{border:1px solid #444;padding:0.4rem;text-align:left}",
].join("")

/** Sandboxed iframe document for HTML previews — scripts cannot run. */
export const wrapSanitizedPreviewSrcDoc = (sanitizedHtml: string): string => {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${PREVIEW_SRCDOC_STYLES}</style></head><body>${sanitizedHtml}</body></html>`
}

/**
 * Neutral paper-page backdrop for the docx page-based preview — a fixed
 * light tone regardless of app theme (this is a facsimile of a printed
 * page, not themed UI chrome) with a subtle card shadow behind whatever
 * page/section elements docx-preview's own generated CSS produces.
 */
const DOCX_PAGE_SRCDOC_STYLES = [
  "html{background:#e2e2e2}",
  "body{margin:0;padding:24px;display:flex;flex-direction:column;align-items:center;font:14px/1.5 system-ui,sans-serif;color:#111}",
  ".docx-page-snapshot{display:flex;flex-direction:column;align-items:center;gap:24px}",
  ".docx-page-snapshot section{background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.2),0 1px 2px rgba(0,0,0,.12)}",
].join("")

/**
 * Sandboxed iframe document for the docx page-based preview (docx-preview
 * output, pre-sanitized by docx-page-preview.ts — this wrapper adds no
 * further sanitization of its own, it only supplies presentational chrome
 * around already-safe content).
 */
export const wrapDocxPagePreviewSrcDoc = (sanitizedFragment: string): string => {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${DOCX_PAGE_SRCDOC_STYLES}</style></head><body>${sanitizedFragment}</body></html>`
}
