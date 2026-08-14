// Brutal PDF encoding / structure fixtures for the ingest circuit.
// Homemade parser skips non-Flate filters and does not recurse Form XObjects —
// those outcomes are measured limits, not production bugs.

import zlib from "node:zlib"
import { Buffer } from "node:buffer"
import { makeValidScannedJpegPdf, renderLegalScanJpeg, SCAN_GROUND_TRUTH } from "./scanned-pdf-fixtures.mjs"

const deflate = (str) => zlib.deflateSync(Buffer.from(str, "latin1"))

const toFile = (buffer, name) => new File([buffer], name, { type: "application/pdf" })

const escapePdf = (s) => s.replace(/[()\\]/g, (c) => "\\" + c)

const assemblePdf = (streamObjects) => {
  const parts = ["%PDF-1.4\n"]
  let objNum = 1
  for (const obj of streamObjects) {
    parts.push(`${objNum} 0 obj\n<< ${obj.dict} >>\nstream\n`)
    parts.push(obj.bytes.toString("latin1"))
    parts.push("\nendstream\nendobj\n")
    objNum += 1
  }
  parts.push("trailer\n<< /Root 1 0 R >>\n%%EOF")
  return Buffer.from(parts.join(""), "latin1")
}

const hexEncode = (str) => {
  let out = ""
  for (let i = 0; i < str.length; i++) {
    out += str.charCodeAt(i).toString(16).padStart(2, "0")
  }
  return out
}

/** ASCIIHexDecode-wrapped content stream (parser should skip, not Latin-1-guess). */
export const makeAsciiHexStreamPdf = (lines, name = "asciihex.pdf") => {
  const ops = lines.map((line) => `(${escapePdf(line)}) Tj T*`).join("\n")
  const content = `BT /F1 12 Tf ${ops} ET`
  const hex = Buffer.from(hexEncode(content) + ">", "latin1")
  return toFile(assemblePdf([{ dict: `/Length ${hex.length} /Filter /ASCIIHexDecode`, bytes: hex }]), name)
}

/** ASCII85Decode-wrapped content (same honesty: withhold, do not invent). */
export const makeAscii85StreamPdf = (lines, name = "ascii85.pdf") => {
  const ops = lines.map((line) => `(${escapePdf(line)}) Tj T*`).join("\n")
  const content = `BT /F1 12 Tf ${ops} ET`
  // Minimal ASCII85 payload — not necessarily valid encode; parser must skip filter.
  const ascii85 = Buffer.from(`<~${Buffer.from(content, "latin1").toString("base64")}~>`, "latin1")
  return toFile(
    assemblePdf([{ dict: `/Length ${ascii85.length} /Filter /ASCII85Decode`, bytes: ascii85 }]),
    name,
  )
}

/**
 * Page content is only `/Fm1 Do` — real text lives in a Form XObject stream.
 * Homemade parser does not recurse Do → measured withhold/OCR limit.
 */
export const makeFormXObjectTextPdf = (lines, name = "form-xobject.pdf") => {
  const ops = lines.map((line) => `(${escapePdf(line)}) Tj T*`).join("\n")
  const formContent = `BT /F1 12 Tf ${ops} ET`
  const formCompressed = deflate(formContent)
  const pageContent = "q /Fm1 Do Q"
  const pageBytes = Buffer.from(pageContent, "latin1")
  const parts = ["%PDF-1.4\n"]
  parts.push(
    `1 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 612 792] /Length ${formCompressed.length} /Filter /FlateDecode >>\nstream\n`,
  )
  parts.push(formCompressed.toString("latin1"))
  parts.push("\nendstream\nendobj\n")
  parts.push(`2 0 obj\n<< /Length ${pageBytes.length} >>\nstream\n`)
  parts.push(pageContent)
  parts.push("\nendstream\nendobj\n")
  parts.push("trailer\n<< /Root 1 0 R >>\n%%EOF")
  return toFile(Buffer.from(parts.join(""), "latin1"), name)
}

/**
 * Real judgment Tj plus a separate unmarked stream of font-license boilerplate.
 * Must extract judgment, never sell license text as the body alone.
 */
export const makeBoilerplateAdjacentPdf = (lines, name = "boilerplate-adjacent.pdf") => {
  const boilerplate =
    "This Font Software is licensed under the SIL Open Font License. " +
    "Reserved Font Name. Copyright Adobe Systems Incorporated. All Rights Reserved Font Name."
  const junk = deflate(`BT (${escapePdf(boilerplate)}) Tj ET`)
  const ops = lines.map((line) => `(${escapePdf(line)}) Tj T*`).join("\n")
  const body = deflate(`BT /F1 12 Tf ${ops} ET`)
  return toFile(
    assemblePdf([
      { dict: `/Length ${junk.length} /Filter /FlateDecode`, bytes: junk },
      { dict: `/Length ${body.length} /Filter /FlateDecode`, bytes: body },
    ]),
    name,
  )
}

/** Text shown via ' and " operators instead of Tj. */
export const makeQuoteOperatorPdf = (lines, name = "quote-ops.pdf") => {
  const ops = lines
    .map((line, i) => {
      const esc = escapePdf(line)
      if (i % 2 === 0) return `(${esc}) '`
      return `0 0 (${esc}) "`
    })
    .join("\n")
  const content = `BT /F1 12 Tf ${ops} ET`
  const compressed = deflate(content)
  return toFile(
    assemblePdf([{ dict: `/Length ${compressed.length} /Filter /FlateDecode`, bytes: compressed }]),
    name,
  )
}

/** Content stream uses Tm rotation (90°) before Tj. */
export const makeRotatedTmPdf = (lines, name = "rotated-tm.pdf") => {
  const ops = lines.map((line) => `(${escapePdf(line)}) Tj T*`).join("\n")
  // 90° rotation matrix then text
  const content = `BT /F1 12 Tf 0 1 -1 0 100 100 Tm ${ops} ET`
  const compressed = deflate(content)
  return toFile(
    assemblePdf([{ dict: `/Length ${compressed.length} /Filter /FlateDecode`, bytes: compressed }]),
    name,
  )
}

/**
 * Searchable scan: JPEG image + invisible text layer matching the golden.
 * Layer may win; CER vs golden when extracted.
 */
export const makeAlignedSearchableScanPdf = (opts = {}) => {
  const text = opts.text ?? SCAN_GROUND_TRUTH
  const { jpeg, width, height } = renderLegalScanJpeg(text, opts.jpegQuality ?? 92, 0)
  const lines = text.split("\n").filter((l) => l.trim())
  const ops = lines.map((line) => `(${escapePdf(line)}) Tj T*`).join("\n")
  // 3 Tr = invisible text rendering mode
  const textStream = `BT 3 Tr /F1 1 Tf ${ops} ET`
  const textBuf = Buffer.from(textStream, "latin1")
  const contentStream = `q\n612 0 0 792 0 0 cm\n/Im1 Do\nQ\n`
  const contentBuf = Buffer.from(contentStream, "latin1")
  const ascii = (s) => Buffer.from(s, "latin1")
  const parts = [ascii("%PDF-1.4\n")]
  const offsets = [0]
  let offset = parts[0].length
  const pushObj = (num, dict, streamBytes) => {
    offsets[num] = offset
    const chunk = streamBytes
      ? Buffer.concat([ascii(`${num} 0 obj\n${dict}\nstream\n`), streamBytes, ascii("\nendstream\nendobj\n")])
      : ascii(`${num} 0 obj\n${dict}\nendobj\n`)
    parts.push(chunk)
    offset += chunk.length
  }
  pushObj(1, "<< /Type /Catalog /Pages 2 0 R >>", null)
  pushObj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", null)
  pushObj(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 4 0 R >> /Font << /F1 7 0 R >> >> /Contents [5 0 R 6 0 R] >>`,
    null,
  )
  pushObj(
    4,
    `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`,
    jpeg,
  )
  pushObj(5, `<< /Length ${contentBuf.length} >>`, contentBuf)
  pushObj(6, `<< /Length ${textBuf.length} >>`, textBuf)
  pushObj(7, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", null)
  const xrefStart = offset
  const xrefLines = ["xref\n", `0 8\n`, "0000000000 65535 f \n"]
  for (let i = 1; i <= 7; i++) {
    xrefLines.push(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`)
  }
  parts.push(ascii(xrefLines.join("")))
  parts.push(ascii(`trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`))
  return new File([Buffer.concat(parts)], opts.name ?? "searchable-aligned.pdf", { type: "application/pdf" })
}

/**
 * Mismatched overlay: image shows golden, hidden layer is font-license poison.
 * Poison must never be sold as extracted judgment body.
 */
export const makeMismatchedOverlayPdf = (opts = {}) => {
  const text = opts.text ?? SCAN_GROUND_TRUTH
  const { jpeg, width, height } = renderLegalScanJpeg(text, 92, 0)
  const poison =
    "This Font Software is licensed under the SIL Open Font License. " +
    "LOREM IPSUM FONT LICENSE AdobeUCS2 All Rights Reserved Font Name. " +
    "begincmap CIDSystemInfo Reserved Font Name PostScript Embedded TrueType."
  const textStream = `BT 3 Tr /F1 12 Tf (${escapePdf(poison)}) Tj ET`
  const textBuf = Buffer.from(textStream, "latin1")
  const contentStream = `q\n612 0 0 792 0 0 cm\n/Im1 Do\nQ\n`
  const contentBuf = Buffer.from(contentStream, "latin1")
  const ascii = (s) => Buffer.from(s, "latin1")
  const parts = [ascii("%PDF-1.4\n")]
  const offsets = [0]
  let offset = parts[0].length
  const pushObj = (num, dict, streamBytes) => {
    offsets[num] = offset
    const chunk = streamBytes
      ? Buffer.concat([ascii(`${num} 0 obj\n${dict}\nstream\n`), streamBytes, ascii("\nendstream\nendobj\n")])
      : ascii(`${num} 0 obj\n${dict}\nendobj\n`)
    parts.push(chunk)
    offset += chunk.length
  }
  pushObj(1, "<< /Type /Catalog /Pages 2 0 R >>", null)
  pushObj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", null)
  pushObj(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 4 0 R >> /Font << /F1 7 0 R >> >> /Contents [5 0 R 6 0 R] >>`,
    null,
  )
  pushObj(
    4,
    `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`,
    jpeg,
  )
  pushObj(5, `<< /Length ${contentBuf.length} >>`, contentBuf)
  pushObj(6, `<< /Length ${textBuf.length} >>`, textBuf)
  pushObj(7, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", null)
  const xrefStart = offset
  const xrefLines = ["xref\n", `0 8\n`, "0000000000 65535 f \n"]
  for (let i = 1; i <= 7; i++) {
    xrefLines.push(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`)
  }
  parts.push(ascii(xrefLines.join("")))
  parts.push(ascii(`trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`))
  return new File([Buffer.concat(parts)], opts.name ?? "searchable-mismatch.pdf", { type: "application/pdf" })
}

/** Re-export scan builder for multi-page image-only PDFs (used by caps stage). */
export const makeMultiPageScannedPdf = (pageCount, opts = {}) => {
  const text = opts.text ?? SCAN_GROUND_TRUTH
  const { jpeg, width, height } = renderLegalScanJpeg(text, opts.jpegQuality ?? 85, 0)
  const ascii = (s) => Buffer.from(s, "latin1")
  const pageW = 612
  const pageH = 792
  const contentStream = `q\n${pageW} 0 0 ${pageH} 0 0 cm\n/Im1 Do\nQ\n`
  const contentBuf = ascii(contentStream)

  // Objects: 1 Catalog, 2 Pages, then for each page: Page dict, shared? image per page, content
  // Simpler: one image object shared, N page objects + N content streams
  const parts = [ascii("%PDF-1.4\n")]
  const offsets = [0]
  let offset = parts[0].length
  const pushObj = (num, dict, streamBytes) => {
    offsets[num] = offset
    const chunk = streamBytes
      ? Buffer.concat([ascii(`${num} 0 obj\n${dict}\nstream\n`), streamBytes, ascii("\nendstream\nendobj\n")])
      : ascii(`${num} 0 obj\n${dict}\nendobj\n`)
    parts.push(chunk)
    offset += chunk.length
  }

  const kids = []
  let nextNum = 3
  const pageNums = []
  for (let i = 0; i < pageCount; i++) {
    pageNums.push(nextNum)
    kids.push(`${nextNum} 0 R`)
    nextNum += 2 // page + content; image is shared as obj after pages setup
  }
  const imageNum = nextNum
  nextNum += 1

  pushObj(1, "<< /Type /Catalog /Pages 2 0 R >>", null)
  pushObj(2, `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pageCount} >>`, null)

  for (let i = 0; i < pageCount; i++) {
    const pageNum = pageNums[i]
    const contentNum = pageNum + 1
    pushObj(
      pageNum,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im1 ${imageNum} 0 R >> >> /Contents ${contentNum} 0 R >>`,
      null,
    )
    pushObj(contentNum, `<< /Length ${contentBuf.length} >>`, contentBuf)
  }
  pushObj(
    imageNum,
    `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`,
    jpeg,
  )

  const maxObj = imageNum
  const xrefStart = offset
  const xrefLines = ["xref\n", `0 ${maxObj + 1}\n`, "0000000000 65535 f \n"]
  for (let i = 1; i <= maxObj; i++) {
    xrefLines.push(`${String(offsets[i] ?? 0).padStart(10, "0")} 00000 n \n`)
  }
  parts.push(ascii(xrefLines.join("")))
  parts.push(ascii(`trailer\n<< /Size ${maxObj + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`))
  return new File([Buffer.concat(parts)], opts.name ?? `scan-${pageCount}p.pdf`, { type: "application/pdf" })
}

export { makeValidScannedJpegPdf }
