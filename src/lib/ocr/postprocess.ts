/**
 * Deterministic cleanup of Tesseract output for Commonwealth/Caribbean
 * legal prose. Never invents citations or party names — only repairs
 * well-known OCR confusions (line-break hyphenation, year O/0, spacing
 * around "v." and bracketed citations) so the existing metadata
 * heuristics in legal-extraction.ts see the same shapes they already
 * match on text-layer PDFs.
 */

export const postprocessOcrText = (raw: string): string => {
  let text = raw.replace(/\r\n/g, "\n")

  // Rejoin words split by a hyphen at a line break ("manslaugh-\nter").
  text = text.replace(/([A-Za-z])-\n([a-z])/g, "$1$2")

  // Tesseract often emits a newline per visual line — keep paragraph
  // breaks (blank lines) but collapse single newlines to spaces so
  // citation regexes that expect a line of prose still fire.
  text = text.replace(/([^\n])\n(?!\n)/g, "$1 ")

  text = text.replace(/[ \t]+\n/g, "\n")
  text = text.replace(/[ \t]{2,}/g, " ")
  text = text.replace(/\n{3,}/g, "\n\n")

  // Bracketed years: "[ 2020 ]" / "[2O2O]" / "[l980]"
  text = text.replace(/\[\s*([IOlo0-9]{4})\s*\]/g, (_m, year: string) => {
    const digits = year.replace(/[Oo]/g, "0").replace(/[Il]/g, "1")
    return `[${digits}]`
  })

  // Parenthesized report years: "( l973 )" / "(I973)"
  text = text.replace(/\(\s*([IOlo0-9]{4})\s*\)/g, (_m, year: string) => {
    const digits = year.replace(/[Oo]/g, "0").replace(/[Il]/g, "1")
    return `(${digits})`
  })

  // "v" between party names is almost always "v." in this corpus.
  text = text.replace(/\b([A-Z][A-Za-z.'-]+)\s+v\s+([A-Z])/g, "$1 v $2")
  text = text.replace(/\bv\.\s+/g, "v. ")

  // Common small-word OCR swaps that survive as whole tokens.
  text = text.replace(/\b0f\b/g, "of")
  text = text.replace(/\b0n\b/g, "on")
  text = text.replace(/\btbe\b/gi, "the")
  text = text.replace(/\bthc\b/gi, "the")
  text = text.replace(/\bTeh\b/g, "The")

  // Collapse spaces inside a reporter citation volume/page run.
  text = text.replace(/\(\s*(\d{4})\s*\)\s+(\d+)\s+([A-Z]{2,})\s+(\d+)/g, "($1) $2 $3 $4")

  return text.trim()
}
