/**
 * Conservative Markdown → HTML for the in-app viewer.
 * Escapes first, then applies a small set of CommonMark-ish constructs
 * used in legal notes (headings, emphasis, links, lists, fenced code).
 */

import { escapeHtml } from "@/lib/html-sanitize"

const renderInline = (text: string): string => {
  let html = escapeHtml(text)
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>")
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
  html = html.replace(/__([^_]+)__/g, "<strong>$1</strong>")
  html = html.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>")
  html = html.replace(
    /\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
    '<a href="$2" rel="noopener noreferrer" target="_blank">$1</a>',
  )
  return html
}

export const markdownToSafeHtml = (source: string): string => {
  const lines = source.replace(/\r\n/g, "\n").split("\n")
  const out: string[] = []
  let i = 0
  let inList = false

  const closeList = () => {
    if (inList) {
      out.push("</ul>")
      inList = false
    }
  }

  while (i < lines.length) {
    const line = lines[i]

    if (line.startsWith("```")) {
      closeList()
      const fence: string[] = []
      i += 1
      while (i < lines.length && !lines[i].startsWith("```")) {
        fence.push(lines[i])
        i += 1
      }
      out.push(`<pre><code>${escapeHtml(fence.join("\n"))}</code></pre>`)
      i += 1
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      closeList()
      const level = heading[1].length
      out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`)
      i += 1
      continue
    }

    if (/^[-*]\s+/.test(line)) {
      if (!inList) {
        out.push("<ul>")
        inList = true
      }
      out.push(`<li>${renderInline(line.replace(/^[-*]\s+/, ""))}</li>`)
      i += 1
      continue
    }

    if (!line.trim()) {
      closeList()
      i += 1
      continue
    }

    closeList()
    const para: string[] = [line]
    i += 1
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s+|```|[-*]\s+)/.test(lines[i])) {
      para.push(lines[i])
      i += 1
    }
    out.push(`<p>${renderInline(para.join(" "))}</p>`)
  }
  closeList()
  return out.join("\n")
}
