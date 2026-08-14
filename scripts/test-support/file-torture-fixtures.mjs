// File-type / MIME / encoding / Office torture builders for the brutal circuit.

import { Buffer } from "node:buffer"
import JSZip from "jszip"
import { SCAN_GROUND_TRUTH } from "./scanned-pdf-fixtures.mjs"

export const makeFile = (name, contents, type = "") =>
  new File([contents], name, type ? { type } : undefined)

export const GOLDEN_LINES = SCAN_GROUND_TRUTH.split("\n").filter((l) => l.length > 0)
export const GOLDEN = SCAN_GROUND_TRUTH
export const GOLDEN_PROSE = GOLDEN_LINES.join(" ")

const oleMagic = () =>
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...new Array(248).fill(0)])

const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
  <Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>
</Types>`

const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

const emptyDocRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`

export const makeMinimalDocx = async (paragraphText) => {
  const zip = new JSZip()
  zip.file("[Content_Types].xml", contentTypesXml)
  zip.file("_rels/.rels", rootRels)
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t xml:space="preserve">${paragraphText}</w:t></w:r></w:p>
  </w:body>
</w:document>`,
  )
  zip.file("word/_rels/document.xml.rels", emptyDocRels)
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" })
}

export const makeEmptyDocx = async () => makeMinimalDocx("")

export const makeCorruptDocx = () => Buffer.from("PK\x03\x04truncated-zip-payload", "binary")

/** OLE CFB magic named .docx — encrypted OOXML shape; mammoth cannot unzip. */
export const makeOleEncryptedDocx = () => oleMagic()

/** Golden only in header1.xml — mammoth skips headers → pending empty. */
export const makeHeaderOnlyDocx = async (headerText) => {
  const zip = new JSZip()
  zip.file("[Content_Types].xml", contentTypesXml)
  zip.file("_rels/.rels", rootRels)
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/></w:sectPr>
  </w:body>
</w:document>`,
  )
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
</Relationships>`,
  )
  zip.file(
    "word/header1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p><w:r><w:t xml:space="preserve">${headerText}</w:t></w:r></w:p>
</w:hdr>`,
  )
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" })
}

/** Tracked changes: insert golden, delete a fake citation. */
export const makeTrackedChangesDocx = async (insertedText) => {
  const zip = new JSZip()
  zip.file("[Content_Types].xml", contentTypesXml)
  zip.file("_rels/.rels", rootRels)
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:ins w:id="1" w:author="Curator"><w:r><w:t xml:space="preserve">${insertedText}</w:t></w:r></w:ins>
      <w:del w:id="2" w:author="Curator"><w:r><w:delText>FAKE CITATION (9999) 99 ZZZ 999 MUST NOT APPEAR</w:delText></w:r></w:del>
    </w:p>
  </w:body>
</w:document>`,
  )
  zip.file("word/_rels/document.xml.rels", emptyDocRels)
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" })
}

/** Body + footnote containing part of golden. */
export const makeFootnotesDocx = async (bodyText, footnoteText) => {
  const zip = new JSZip()
  zip.file("[Content_Types].xml", contentTypesXml)
  zip.file("_rels/.rels", rootRels)
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r><w:t xml:space="preserve">${bodyText}</w:t></w:r>
      <w:r><w:footnoteReference w:id="1"/></w:r>
    </w:p>
  </w:body>
</w:document>`,
  )
  zip.file(
    "word/footnotes.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:footnote w:id="1"><w:p><w:r><w:t xml:space="preserve">${footnoteText}</w:t></w:r></w:p></w:footnote>
</w:footnotes>`,
  )
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdFn" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>
</Relationships>`,
  )
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" })
}

/** Docx with only an embedded PNG, no w:t. */
export const makeImageOnlyDocx = async (pngBytes) => {
  const zip = new JSZip()
  zip.file("[Content_Types].xml", contentTypesXml)
  zip.file("_rels/.rels", rootRels)
  zip.file("word/media/image1.png", pngBytes)
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
  <w:body>
    <w:p><w:r>
      <w:drawing><wp:inline><a:graphic><a:graphicData>
        <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
          <pic:blipFill><a:blip r:embed="rIdImg"/></pic:blipFill>
        </pic:pic>
      </a:graphicData></a:graphic></wp:inline></w:drawing>
    </w:r></w:p>
  </w:body>
</w:document>`,
  )
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>`,
  )
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" })
}

/** Macro-enabled payload with .docx name (body may still extract). */
export const makeDocxWithVba = async (bodyText) => {
  const zip = new JSZip()
  zip.file("[Content_Types].xml", contentTypesXml)
  zip.file("_rels/.rels", rootRels)
  zip.file("word/vbaProject.bin", Buffer.from("FAKE-VBA-PROJECT-BYTES-NOT-EXECUTABLE", "utf8"))
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t xml:space="preserve">${bodyText}</w:t></w:r></w:p>
  </w:body>
</w:document>`,
  )
  zip.file("word/_rels/document.xml.rels", emptyDocRels)
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" })
}

export const makeDocmStub = async () => {
  const zip = new JSZip()
  zip.file("[Content_Types].xml", contentTypesXml)
  zip.file("_rels/.rels", rootRels)
  zip.file("word/vbaProject.bin", Buffer.from("VBA", "utf8"))
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>macro body</w:t></w:r></w:p></w:body>
</w:document>`,
  )
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" })
}

export const makeZipOfPdfs = async (pdfBuffers) => {
  const zip = new JSZip()
  pdfBuffers.forEach((buf, i) => zip.file(`doc${i + 1}.pdf`, buf))
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" })
}

export const makeUtf16LeTxt = (text) => {
  const bom = Buffer.from([0xff, 0xfe])
  return Buffer.concat([bom, Buffer.from(text, "utf16le")])
}

export const makeUtf16BeTxt = (text) => {
  const bom = Buffer.from([0xfe, 0xff])
  const le = Buffer.from(text, "utf16le")
  const be = Buffer.alloc(le.length)
  for (let i = 0; i < le.length; i += 2) {
    be[i] = le[i + 1]
    be[i + 1] = le[i]
  }
  return Buffer.concat([bom, be])
}

export const makeUtf8BomTxt = (text) => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, "utf8")])

/** Windows-1252 bytes for café (€ = 0x80, é = 0xE9). */
export const makeWindows1252Txt = () => {
  const prefix = "IN THE COURT OF APPEAL OF GUYANA. The "
  const suffix =
    " witness gave testimony. THE STATE v DHANNIE RAMSINGH (1973) 20 WIR 138. " +
    "The appellant was convicted of manslaughter following a trial in the High Court. " +
    "Counsel submitted that certain admissions were wrongly admitted as hearsay evidence. " +
    "The Court considered the relevant authorities at length before dismissing the appeal."
  const mid = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x20, 0x80]) // café €
  return Buffer.concat([Buffer.from(prefix, "ascii"), mid, Buffer.from(suffix, "ascii")])
}

export const makeHtmlAsTxt = (goldenPhrase) =>
  `<!DOCTYPE html><html><body><script>alert(1)</script><p>${goldenPhrase}</p></body></html>`

export const makeRtfAsTxt = () =>
  `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Times;}}\\f0\\fs24 Not a judgment body.\\par}`

export const makeJpegPdfPolyglot = (jpegBytes, pdfBytes) => {
  // Keep %PDF within first 1KB: small JPEG then PDF
  const marker = Buffer.from("\n%PDF-POLY\n", "latin1")
  return Buffer.concat([jpegBytes.subarray(0, Math.min(400, jpegBytes.length)), marker, pdfBytes])
}

export const truncateJpeg = (jpegBytes) => {
  // Drop EOI marker if present
  let end = jpegBytes.length
  if (jpegBytes[end - 2] === 0xff && jpegBytes[end - 1] === 0xd9) end -= 2
  return jpegBytes.subarray(0, Math.max(32, end - 40))
}

export { oleMagic }
