/**
 * Sanitization for docx-preview's rendered page output — deliberately a
 * much richer allowlist than html-sanitize.ts's sanitizePreviewHtml (which
 * strips ALL attributes; fine for mammoth's small semantic-HTML tag set).
 * This preview's entire value proposition is preserving page geometry,
 * fonts, spacing, indentation, and table borders, which live in `style`/
 * `class` attributes docx-preview itself generates — not anything a
 * document author's OOXML markup could put there directly.
 *
 * Runs on a real parsed DOM via DOMPurify (not regex-over-string), which is
 * meaningfully more robust against obfuscated/malformed-markup bypasses
 * once attributes re-enter the allowlist. The caller supplies its own
 * DOMPurify instance (browser code passes the window-bound default export;
 * tests pass one built from jsdom) so this module never has to know
 * whether it's running in a browser or Node.
 */

import type { DOMPurify as DOMPurifyInstance } from "dompurify"
import { isSafeHref } from "@/lib/html-sanitize"

const BODY_ALLOWED_TAGS = [
  "div", "span", "p", "br", "hr",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "strong", "b", "em", "i", "u", "s", "sup", "sub",
  "ul", "ol", "li",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "colgroup", "col", "caption",
  "a", "img",
  "header", "footer", "section", "article", "figure", "figcaption",
  "blockquote", "small",
]

const BODY_ALLOWED_ATTR = [
  "style", "class", "id", "href", "src",
  "colspan", "rowspan", "width", "height",
  "align", "valign", "dir", "lang", "title", "alt",
]

const BODY_FORBID_TAGS = [
  "script", "iframe", "object", "embed", "form", "input", "button",
  "textarea", "svg", "math", "link", "meta", "base", "style",
]

/** Only https(s)/mailto links or fragment anchors (footnote/endnote refs), and only data:image/... for embedded images. Anything else is stripped, not merely left inert. */
const BODY_ALLOWED_URI_REGEXP = /^(?:https?:|mailto:|data:image\/|#)/i

/**
 * Sanitizes docx-preview's rendered page body (its `bodyContainer.innerHTML`
 * after `renderAsync`). Strips anything outside the allowlist above,
 * enforces safe href/src schemes on top of DOMPurify's own URI check (an
 * `<a>` failing `isSafeHref` loses its href entirely rather than being left
 * with a possibly-dangerous one), and forces `rel="noopener noreferrer"
 * target="_blank"` on the links that remain — matching sanitizePreviewHtml's
 * existing link-hardening behavior.
 */
export const sanitizeDocxPageBody = (html: string, purify: DOMPurifyInstance): string => {
  const onAttr = (node: Element) => {
    if (node.tagName === "A" && node.hasAttribute("href")) {
      const href = node.getAttribute("href") ?? ""
      if (!isSafeHref(href)) {
        node.removeAttribute("href")
      } else {
        node.setAttribute("rel", "noopener noreferrer")
        node.setAttribute("target", "_blank")
      }
    }
    if (node.tagName === "IMG" && node.hasAttribute("src")) {
      const src = (node.getAttribute("src") ?? "").trim().toLowerCase()
      if (!src.startsWith("data:image/")) {
        node.removeAttribute("src")
      }
    }
  }
  purify.addHook("afterSanitizeAttributes", onAttr)
  try {
    return purify.sanitize(html, {
      ALLOWED_TAGS: BODY_ALLOWED_TAGS,
      ALLOWED_ATTR: BODY_ALLOWED_ATTR,
      FORBID_TAGS: BODY_FORBID_TAGS,
      ALLOW_DATA_ATTR: false,
      ALLOWED_URI_REGEXP: BODY_ALLOWED_URI_REGEXP,
    })
  } finally {
    purify.removeHook("afterSanitizeAttributes")
  }
}

/**
 * Strips any CSS `url(...)` that isn't a `data:` URI — closes off a crafted
 * .docx loading an external resource (e.g. a tracking pixel) from the
 * generated stylesheet, independent of the structural sanitization below.
 * `useBase64URL: true` (docx-page-preview.ts) already makes docx-preview
 * emit `url(data:...)` for every legitimate embedded image/font, so
 * ordinary output is unaffected.
 */
export const stripNonDataCssUrls = (css: string): string => {
  return css.replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (full, _quote, value: string) => {
    return value.trim().toLowerCase().startsWith("data:") ? full : "url()"
  })
}

/**
 * Sanitizes docx-preview's generated `<style>` block(s) (its
 * `styleContainer.innerHTML`). Runs it through DOMPurify allowing ONLY the
 * `style` tag itself first — a real HTML parse, so an adversarial CSS value
 * (e.g. a crafted font-family string) that attempts a `</style>` breakout
 * is parsed exactly as a browser would and anything after the break is
 * dropped, not merely hidden — then scrubs any remaining external CSS
 * `url()` reference.
 */
export const sanitizeDocxPageStyle = (styleMarkup: string, purify: DOMPurifyInstance): string => {
  const structurallySafe = purify.sanitize(styleMarkup, {
    ALLOWED_TAGS: ["style"],
    ALLOWED_ATTR: [],
    // Without this, DOMPurify parses a standalone <style> tag into an
    // implicit <head> and only returns <body> content, silently dropping
    // it entirely -- confirmed via test-docx-page-preview-sanitize.mjs.
    FORCE_BODY: true,
  })
  return stripNonDataCssUrls(structurallySafe)
}
