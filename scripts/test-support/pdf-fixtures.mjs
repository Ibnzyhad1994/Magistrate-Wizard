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

/**
 * Reproduces the real Task-4 regression: a genuine header/body text
 * content stream (real judgment-shaped text, "The State v Test Appellant
 * (1973) 20 XYZ 138 ... COURT OF APPEAL") PLUS a separate ToUnicode CMap
 * stream — structurally identical to what real PDF producers embed for
 * every non-base14 font, with NO distinguishing /Type or /Subtype marker
 * of its own (so the object-dict-based exclusions in
 * pdf-text-extraction.ts cannot catch it — only the content-based
 * begincmap/CIDSystemInfo check can). Before this pass's fix, the CMap
 * stream's literal `/Registry (Adobe) /Ordering (UCS2)` values leaked
 * into the extracted text as "AdobeUCS2" garbage ahead of the real
 * content. This fixture proves the fix generically (no case-specific
 * text), independent of any particular jurisdiction/case name.
 */
export function makeCmapPollutedPdf(name = "cmap-polluted.pdf") {
  const cmapContent = [
    "/CIDInit /ProcSet findresource begin",
    "12 dict begin",
    "begincmap",
    "/CIDSystemInfo",
    "<< /Registry (Adobe)",
    "/Ordering (UCS2)",
    "/Supplement 0",
    ">> def",
    "/CMapName /Adobe-Identity-UCS2 def",
    "1 begincodespacerange",
    "<0000> <FFFF>",
    "endcodespacerange",
    "endcmap",
    "CMapName currentdict /CMap defineresource pop",
    "end",
    "end",
  ].join("\n");
  const cmapCompressed = deflate(cmapContent);
  // Deliberately no /Type or /Subtype in this stream's own dictionary —
  // matches how real ToUnicode CMap stream objects are declared.
  const cmapStreamObj = { dict: "/Length " + cmapCompressed.length + " /Filter /FlateDecode", bytes: cmapCompressed };

  const bodyLines = [
    "The State v Test Appellant",
    "(1973) 20 XYZ 138",
    "COURT OF APPEAL OF TESTLAND",
    "The appellant was convicted following a trial in the High Court.",
    "Counsel submitted that certain admissions were wrongly admitted as hearsay evidence at trial.",
    "The Court considered the relevant authorities before dismissing the appeal in this matter.",
  ];
  const ops = bodyLines.map((line) => `(${line.replace(/[()\\]/g, (c) => "\\" + c)}) Tj T*`).join("\n");
  const bodyContent = `BT /F1 12 Tf ${ops} ET`;
  const bodyCompressed = deflate(bodyContent);
  const bodyStreamObj = { dict: "/Length " + bodyCompressed.length + " /Filter /FlateDecode", bytes: bodyCompressed };

  // CMap stream ordered FIRST -- reproduces the observed real-world byte
  // order where the polluting stream appears ahead of the actual page
  // content stream in the file.
  return toFile(assemblePdf([cmapStreamObj, bodyStreamObj]), name);
}

/**
 * A genuine `[ (...) N (...) N ... ] TJ` array — the kerned-text form real
 * word-processor/typesetting PDF producers commonly emit instead of a
 * bare `Tj` per word. Used to confirm the Tj/TJ-operand-confirmation
 * rewrite still extracts genuine array text (not just bare Tj strings).
 */
export function makeTjArrayPdf(name = "tj-array.pdf") {
  const content = `BT /F1 12 Tf [(Hello) -250 (World) -300 (Testing)] TJ ET`;
  const compressed = deflate(content);
  const streamObj = { dict: "/Length " + compressed.length + " /Filter /FlateDecode", bytes: compressed };
  return toFile(assemblePdf([streamObj]), name);
}

/**
 * A non-TJ array (e.g. a dash pattern for the `d` operator) that happens
 * to contain parenthesized-looking content is NOT constructed here since
 * real dash-pattern arrays only ever contain numbers -- instead this
 * fixture proves the negative case directly: a bare literal NOT followed
 * by Tj (simulating any other operator's string operand, e.g. a color
 * space name or an XObject-adjacent literal) must never be kept as text.
 */
export function makeBareLiteralNotTjPdf(name = "bare-literal-not-tj.pdf") {
  const content = `BT /F1 12 Tf (Real Shown Text) Tj (Not Shown) Tf ET`;
  const compressed = deflate(content);
  const streamObj = { dict: "/Length " + compressed.length + " /Filter /FlateDecode", bytes: compressed };
  return toFile(assemblePdf([streamObj]), name);
}

/**
 * The "body citation trap": a genuine, well-formed header (case name +
 * citation + court, exactly like a real judgment) followed immediately by
 * MANY body citations of OTHER cases in typical "cited authorities"
 * prose, including a pincite-style reference ("... at 142 R v Someone
 * Else (1967) 62 ABC 408 ...") — the real shape of the reported "at 142R
 * v Ferguson and Willoughby" false-positive. Proves extractCaseName picks
 * the genuine header, not a body/cited-authority citation, regardless of
 * how many body citations exist before the 2000-character head window
 * ends. No case-specific text is asserted on by name in the fixture
 * itself — this is a structural pattern (header-then-many-citations), not
 * a fixture pinned to one jurisdiction.
 */
export function makeBodyCitationTrapPdf(name = "body-citation-trap.pdf") {
  const lines = [
    "The Queen v Test Respondent",
    "(1985) 33 ABC 210",
    "COURT OF APPEAL OF SOMEWHERE",
    "The appellant was convicted of an offence and now appeals against conviction and sentence.",
    "Counsel for the appellant relied on a number of authorities in support of the submissions made.",
    "See in particular the decision at 142 R v Ferguson and Someone (1967) 62 DEF 408, Digest of Cases,",
    "and also the earlier authority of R v Whitfield (1971) 15 GHI 92, and further R v Alonso (1962) 8 JKL 44,",
    "each of which considered similar questions of admissibility of hearsay evidence in criminal trials.",
    "The Court considered these authorities at length before dismissing the appeal in this matter.",
  ];
  const ops = lines.map((line) => `(${line.replace(/[()\\]/g, (c) => "\\" + c)}) Tj T*`).join("\n");
  const content = `BT /F1 12 Tf ${ops} ET`;
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
