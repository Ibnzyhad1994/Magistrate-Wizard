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

const isSafeHref = (href: string): boolean => {
  const trimmed = href.trim()
  return /^(https?:|mailto:|#)/i.test(trimmed) && !/^\s*javascript:/i.test(trimmed)
}

export const sanitizePreviewHtml = (html: string): string => {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<\/?([a-zA-Z0-9]+)(\s[^>]*)?>/g, (full, tag: string, attrs: string | undefined) => {
      const closing = full.startsWith("</")
      const name = tag.toLowerCase()
      if (!ALLOWED_TAGS.has(name)) return ""
      if (closing) return `</${name}>`
      if (name === "br" || name === "hr") return `<${name} />`
      if (name === "a") {
        const hrefMatch = (attrs ?? "").match(/\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i)
        const href = hrefMatch?.[2] ?? hrefMatch?.[3] ?? hrefMatch?.[4] ?? ""
        if (!href || !isSafeHref(href)) return "<a>"
        return `<a href="${escapeHtml(href)}" rel="noopener noreferrer" target="_blank">`
      }
      return `<${name}>`
    })
}
