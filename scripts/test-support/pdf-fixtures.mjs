// Synthetic PDF fixture builders for scripts/tests/*.mjs — constructs
// minimal but STRUCTURALLY VALID PDFs with real FlateDecode-compressed
// streams (via Node's zlib, the same DEFLATE algorithm the browser's
// DecompressionStream('deflate') expects), so tests exercise the actual
// runPdfExtractionPipeline / extractPdfTextLayer code path end to end.
//
// These are synthetic, not the real historical PDFs referenced in the
// governing task (no PDF library and no network access exist in this
// sandbox to fetch or parse real judgment PDFs — see the final report's
// honesty notes) — built to reproduce the STRUCTURAL patterns those real
// PDFs exhibited (a genuine text-bearing content stream; an embedded
// font-program-like stream containing license/boilerplate text; an
// image-only page with no text operators at all).

import zlib from "node:zlib";

function deflate(str) {
  return zlib.deflateSync(Buffer.from(str, "latin1"));
}

/** Wraps one or more pre-built stream objects (each `{ dict, bytes }`) into a minimal but complete PDF file (header, objects, trailer with EOF marker so the byte-scanning parser has a coherent file to work with — it doesn't parse xref, so the trailer content itself doesn't need to be accurate). */
function assemblePdf(streamObjects) {
  const parts = ["%PDF-1.4\n"];
  let objNum = 1;
  for (const { dict } of streamObjects) {
    void dict;
  }
  for (const obj of streamObjects) {
    parts.push(`${objNum} 0 obj\n<< ${obj.dict} >>\nstream\n`);
    parts.push(obj.bytes.toString("latin1"));
    parts.push("\nendstream\nendobj\n");
    objNum += 1;
  }
  parts.push("trailer\n<< /Root 1 0 R >>\n%%EOF");
  return Buffer.from(parts.join(""), "latin1");
}

function toFile(buffer, name) {
  return new File([buffer], name, { type: "application/pdf" });
}

/** A single legitimate page content stream showing `text` via one Tj per line (joined with `Td` moves, exactly like a real content stream produced by a word processor / print-to-PDF). */
export function makeTextPdf(lines, name = "clean.pdf") {
  const ops = lines.map((line) => `(${line.replace(/[()\\]/g, (c) => "\\" + c)}) Tj T*`).join("\n");
  const content = `BT /F1 12 Tf ${ops} ET`;
  const compressed = deflate(content);
  const streamObj = { dict: "/Length " + compressed.length + " /Filter /FlateDecode", bytes: compressed };
  return toFile(assemblePdf([streamObj]), name);
}

/** Same as makeTextPdf but with every line concatenated with NO Td/T* between them (no line-break operator at all) — reproduces the observed "concatenated but still readable" real-PDF pattern (all text glued into one long run). */
export function makeConcatenatedTextPdf(text, name = "concatenated.pdf") {
  const escaped = text.replace(/[()\\]/g, (c) => "\\" + c);
  const content = `BT /F1 12 Tf (${escaped}) Tj ET`;
  const compressed = deflate(content);
  const streamObj = { dict: "/Length " + compressed.length + " /Filter /FlateDecode", bytes: compressed };
  return toFile(assemblePdf([streamObj]), name);
}

/**
 * A stream containing REAL, readable text — but font/license boilerplate,
 * not document content — with NO distinguishing /Type or /Length1 marker
 * in its own dictionary (deliberately, to test the extraction QUALITY
 * GATE as a backstop independent of pdf-text-extraction.ts's stream-type
 * exclusions, which only catch streams that DO carry those markers).
 */
export function makeFontBoilerplatePdf(name = "boilerplate.pdf") {
  const boilerplate =
    "This Font Software is licensed under the SIL Open Font License. " +
    "Reserved Font Name refers to any Reserved Font Name(s). " +
    "PostScript name: Embedded TrueType CIDFont Glyph CMap ObjStm XRef Stream. " +
    "Copyright Adobe Systems Incorporated. All Rights Reserved Font Name.";
  const escaped = boilerplate.replace(/[()\\]/g, (c) => "\\" + c);
  const content = `BT (${escaped}) Tj ET`;
  const compressed = deflate(content);
  const streamObj = { dict: "/Length " + compressed.length + " /Filter /FlateDecode", bytes: compressed };
  return toFile(assemblePdf([streamObj]), name);
}

/**
 * A stream whose Tj literal string contains raw NUL bytes and other
 * binary noise mixed with a little real-looking text — reproduces
 * "corrupted Unicode sequences" being extracted from a misread binary
 * stream. After latin1 decoding, this becomes exactly the kind of string
 * that would previously have reached Supabase and triggered the
 * "unsupported Unicode escape sequence" jsonb error.
 */
export function makeBinaryGarbagePdf(name = "binary-garbage.pdf") {
  const junkBytes = Buffer.alloc(400);
  for (let i = 0; i < junkBytes.length; i++) {
    // A mix of NUL, control bytes, and a few printable letters -- mimics
    // a font glyph table or other binary payload that happens to contain
    // literal '(' / ')' bytes and gets misread as a Tj string.
    junkBytes[i] = i % 7 === 0 ? 0 : i % 11 === 0 ? 65 + (i % 26) : (i * 37) % 32;
  }
  // Escape any literal parens the random bytes happen to produce so the
  // PDF literal-string syntax stays well-formed for the parser.
  const junkLatin1 = junkBytes.toString("latin1").replace(/[()\\]/g, (c) => "\\" + c);
  const content = `BT (${junkLatin1}) Tj ET`;
  const compressed = deflate(content);
  const streamObj = { dict: "/Length " + compressed.length + " /Filter /FlateDecode", bytes: compressed };
  return toFile(assemblePdf([streamObj]), name);
}

/** No text operators at all, an image /Subtype declared — a scanned/image-only page, correctly requires OCR. */
export function makeImageOnlyPdf(name = "image-only.pdf") {
  const fakeJpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8]);
  const imageStream = { dict: "/Type /XObject /Subtype /Image /Filter /DCTDecode /Length " + fakeJpegBytes.length, bytes: fakeJpegBytes };
  const contentStream = { dict: "/Length 20", bytes: Buffer.from("q 1 0 0 1 0 0 cm Q", "latin1") };
  return toFile(assemblePdf([imageStream, contentStream]), name);
}
