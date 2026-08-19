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

/** Long enough TJ-array judgment to clear the parser's 80-char confidence floor. */
export function makeTjJudgmentPdf(lines, name = "tj-judgment.pdf") {
  const words = lines.join(" ").split(/\s+/).filter(Boolean);
  const inner = words
    .map((w) => `(${w.replace(/[()\\]/g, (c) => "\\" + c)}) -200`)
    .join(" ");
  const content = `BT /F1 12 Tf [${inner}] TJ ET`;
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

/**
 * A multi-page PDF: each page gets its own `1 0 obj << /Type /Page ...
 * >>` dictionary object IMMEDIATELY FOLLOWED by its own content stream
 * object — the real-world producer pattern the page-attribution
 * heuristic in pdf-text-extraction.ts (findPageMarkerOffsets/
 * resolvePageIndex) relies on. `pagesText` is an array of arrays of
 * lines (one inner array per page).
 */
export function makeMultiPagePdf(pagesText, name = "multi-page.pdf") {
  const objects = [];
  let objNum = 1;
  for (const lines of pagesText) {
    // The Page dictionary object itself — no text content, just the
    // marker findPageMarkerOffsets scans for. Not a `stream` object, so
    // it doesn't participate in findStreamByteRanges at all; it exists
    // purely to mark "a new page starts here" in file-byte order.
    objects.push({ dict: null, isPageMarker: true, bytes: null });
    const ops = lines.map((line) => `(${line.replace(/[()\\]/g, (c) => "\\" + c)}) Tj T*`).join("\n");
    const content = `BT /F1 12 Tf ${ops} ET`;
    const compressed = deflate(content);
    objects.push({ dict: "/Length " + compressed.length + " /Filter /FlateDecode", bytes: compressed });
  }
  void objNum;
  return toFile(assembleMultiObjectPdf(objects), name);
}

/** Same assembly as assemblePdf, but understands a `{ isPageMarker: true }` pseudo-object (emits a real `<< /Type /Page /Contents N 0 R >>` dictionary object with no stream) interleaved with real stream objects — needed by makeMultiPagePdf above. */
function assembleMultiObjectPdf(objects) {
  const parts = ["%PDF-1.4\n"];
  let objNum = 1;
  for (const obj of objects) {
    if (obj.isPageMarker) {
      parts.push(`${objNum} 0 obj\n<< /Type /Page /Contents ${objNum + 1} 0 R >>\nendobj\n`);
    } else {
      parts.push(`${objNum} 0 obj\n<< ${obj.dict} >>\nstream\n`);
      parts.push(obj.bytes.toString("latin1"));
      parts.push("\nendstream\nendobj\n");
    }
    objNum += 1;
  }
  parts.push("trailer\n<< /Root 1 0 R >>\n%%EOF");
  return Buffer.from(parts.join(""), "latin1");
}

/**
 * Reproduces the live-tested Ramsingh gluing pattern: two Tj text runs
 * back to back with NO Td/T* between them (absolute-positioned text, as
 * many real "print to PDF" law-report producers emit for running
 * headers/footers like page numbers) — "...138" immediately followed by
 * "Page 4 of 72" immediately followed by "DPP v Beard...", all as
 * separate Tj calls with zero separator. Proves the word-boundary
 * spacing heuristic (pushWithSpacingHeuristic) inserts the lost spaces.
 */
export function makeGluedTextPdf(name = "glued-text.pdf") {
  // The glued run itself is short (reproducing the real running-header/
  // footer pattern exactly) — padded with an ordinary trailing sentence
  // (via a normal Td-separated Tj, i.e. NOT part of the glued run) so the
  // combined extracted text clears extraction-quality.ts's MIN_LENGTH (200
  // chars) hard-fail floor and this fixture actually reaches the
  // structural-quality/spacing-heuristic code path under test, rather than
  // being rejected earlier as "too short" for an unrelated reason.
  const content = `BT /F1 12 Tf (The State v Dhannie Ramsingh) Tj T* ((1973) 20 WIR 138) Tj (Page 4 of 72) Tj (DPP v Beard and another matter entirely) Tj T* (The Court considered the relevant authorities at length before making its ruling in this matter and dismissing the appeal.) Tj ET`;
  const compressed = deflate(content);
  const streamObj = { dict: "/Length " + compressed.length + " /Filter /FlateDecode", bytes: compressed };
  return toFile(assemblePdf([streamObj]), name);
}

/** Encodes a latin1 string as PDF hex-string digits (2 hex chars per byte, matching what a 1-byte-per-character SIMPLE font's hex-string Tj/TJ operand looks like in a real content stream). */
function hexEncode(str) {
  let out = "";
  for (let i = 0; i < str.length; i++) {
    out += str.charCodeAt(i).toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * Phase A/D regression fixture: a SIMPLE (non-composite) font PDF whose
 * text-showing operators use HEX STRING operands (`<...> Tj`) rather than
 * literal `(...)` strings — a real, spec-legal encoding choice some PDF
 * producers make, and the root cause (alongside encryption, see
 * makeEncryptedPdf below) this pass identified for why real Canadian
 * court PDFs were reported as "OCR required" despite having a genuine text
 * layer. No composite/Type0 font marker appears anywhere in this file, so
 * pdf-text-extraction.ts should decode these hex operands exactly like a
 * literal string (1 byte = 1 character) and extraction should succeed.
 */
/**
 * Same as makeTextPdf but the content stream is stored uncompressed
 * (no /Filter). Real producers sometimes emit this; the parser must still
 * read Tj/TJ from the raw stream bytes.
 */
export function makeUncompressedTextPdf(lines, name = "uncompressed.pdf") {
  const ops = lines.map((line) => `(${line.replace(/[()\\]/g, (c) => "\\" + c)}) Tj T*`).join("\n");
  const content = `BT /F1 12 Tf ${ops} ET`;
  const bytes = Buffer.from(content, "latin1");
  const streamObj = { dict: "/Length " + bytes.length, bytes };
  return toFile(assemblePdf([streamObj]), name);
}

/**
 * Mixed encoding in one content stream: some lines as literal strings,
 * some as SIMPLE-font hex strings. No Type0 marker — both encodings must
 * survive as the same characters.
 */
export function makeMixedEncodingPdf(literalLines, hexLines, name = "mixed-encoding.pdf") {
  const litOps = literalLines.map((line) => `(${line.replace(/[()\\]/g, (c) => "\\" + c)}) Tj T*`).join("\n");
  const hexOps = hexLines.map((line) => `<${hexEncode(line)}> Tj T*`).join("\n");
  const content = `BT /F1 12 Tf ${litOps}\n${hexOps} ET`;
  const compressed = deflate(content);
  const streamObj = { dict: "/Length " + compressed.length + " /Filter /FlateDecode", bytes: compressed };
  return toFile(assemblePdf([streamObj]), name);
}

export function makeHexTextPdf(lines, name = "hex-text.pdf") {
  const ops = lines.map((line) => `<${hexEncode(line)}> Tj T*`).join("\n");
  const content = `BT /F1 12 Tf ${ops} ET`;
  const compressed = deflate(content);
  const streamObj = { dict: "/Length " + compressed.length + " /Filter /FlateDecode", bytes: compressed };
  return toFile(assemblePdf([streamObj]), name);
}

/**
 * The composite/CID-keyed-font counterpart to makeHexTextPdf: a genuine
 * `/Subtype /Type0 /Encoding /Identity-H` font resource object declared
 * elsewhere in the file (exactly how a real embedded composite font
 * resource is declared — a separate, non-stream object, not inside the
 * content stream itself), alongside a hex-string Tj operand in the content
 * stream. Proves the parser DELIBERATELY WITHHOLDS these hex operands
 * (never decodes them as raw character codes, which would silently
 * fabricate wrong text from CID/glyph codes) and honestly reports
 * `unreadableReason: "unsupported_font_encoding"` rather than a false
 * success. The encoded line is deliberately long enough that a wrongly-
 * decoded result would clear extraction-quality.ts's MIN_LENGTH floor —
 * this fixture would incorrectly PASS a naive "did we get non-empty text"
 * test if the false-success guard were ever removed.
 */
export function makeCompositeFontHexPdf(name = "composite-font-hex.pdf") {
  const longLine =
    "This text is CID-encoded under a composite Type0 font and must never be decoded as raw character codes " +
    "because doing so without the font's ToUnicode CMap would silently produce wrong text instead of an honest failure.";
  const content = `BT /F1 12 Tf <${hexEncode(longLine)}> Tj ET`;
  const compressed = deflate(content);
  const parts = ["%PDF-1.4\n"];
  parts.push("1 0 obj\n<< /Type /Font /Subtype /Type0 /BaseFont /TestCIDFont /Encoding /Identity-H >>\nendobj\n");
  parts.push(`2 0 obj\n<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`);
  parts.push(compressed.toString("latin1"));
  parts.push("\nendstream\nendobj\n");
  parts.push("trailer\n<< /Root 1 0 R >>\n%%EOF");
  return toFile(Buffer.from(parts.join(""), "latin1"), name);
}

/**
 * Phase A/D regression fixture: a PDF whose trailer declares an /Encrypt
 * dictionary reference — the real PDF-spec signal that this file's stream
 * bytes are encrypted (this synthetic fixture does not implement actual
 * RC4/AES PDF encryption; the point under test is DETECTING and honestly
 * REPORTING the /Encrypt marker, not decrypting real cipher output). The
 * content stream's bytes are deliberately NOT valid deflate data — exactly
 * the real symptom an encrypted-but-/FlateDecode-declared stream produces
 * (decompression throws and is silently skipped) — proving isEncrypted
 * detection correctly reports this as `unreadableReason: "encrypted"`
 * rather than the same generic "no_text_found" every other zero-text case
 * gets.
 */
export function makeEncryptedPdf(name = "encrypted.pdf") {
  const notValidDeflateData = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const parts = ["%PDF-1.4\n"];
  parts.push(`1 0 obj\n<< /Length ${notValidDeflateData.length} /Filter /FlateDecode >>\nstream\n`);
  parts.push(notValidDeflateData.toString("latin1"));
  parts.push("\nendstream\nendobj\n");
  parts.push("2 0 obj\n<< /Filter /Standard /V 2 /R 3 /O (garbageowner) /U (garbageuser) /P -4 >>\nendobj\n");
  parts.push("trailer\n<< /Root 1 0 R /Encrypt 2 0 R >>\n%%EOF");
  return toFile(Buffer.from(parts.join(""), "latin1"), name);
}

/** No text operators at all, an image /Subtype declared — a scanned/image-only page, correctly requires OCR. */
export function makeImageOnlyPdf(name = "image-only.pdf") {
  const fakeJpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8]);
  const imageStream = { dict: "/Type /XObject /Subtype /Image /Filter /DCTDecode /Length " + fakeJpegBytes.length, bytes: fakeJpegBytes };
  const contentStream = { dict: "/Length 20", bytes: Buffer.from("q 1 0 0 1 0 0 cm Q", "latin1") };
  return toFile(assemblePdf([imageStream, contentStream]), name);
}

/**
 * Page 1 is a short FlateDecode content stream (homemade parser finds it).
 * Page 2 is a much longer ASCIIHexDecode stream (homemade skips unknown
 * filters; pdf.js walks the page tree and recovers both pages).
 */
export function makeHomemadeShortPdfjsLongPdf(name = "homemade-short-pdfjs-long.pdf") {
  const escape = (line) => line.replace(/[()\\]/g, (c) => "\\" + c);
  const tj = (lines) =>
    `BT /F1 12 Tf ${lines.map((line) => `(${escape(line)}) Tj T*`).join("\n")} ET`;
  const page1 = tj([
    "Perreira v Cummings — page one only.",
    "The lightweight parser stops after this short first content stream while later pages use a filter it does not decode.",
    "The Court heard a preliminary point and reserved its ruling on the application before it.",
  ]);
  const page1Bytes = deflate(page1);
  const later = [];
  for (let i = 1; i <= 24; i++) {
    later.push(
      `Later page paragraph ${i}: the appellant submitted that the learned trial judge misdirected the jury on the standard of proof and the meaning of recent possession in this matter.`,
    );
  }
  const page2Hex = hexEncode(tj(later)) + ">";
  const page2Bytes = Buffer.from(page2Hex, "latin1");
  const font =
    "7 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n";
  const parts = ["%PDF-1.4\n"];
  parts.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  parts.push("2 0 obj\n<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>\nendobj\n");
  parts.push(
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 7 0 R >> >> >>\nendobj\n",
  );
  parts.push(`4 0 obj\n<< /Length ${page1Bytes.length} /Filter /FlateDecode >>\nstream\n`);
  parts.push(page1Bytes.toString("latin1"));
  parts.push("\nendstream\nendobj\n");
  parts.push(
    "5 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 6 0 R /Resources << /Font << /F1 7 0 R >> >> >>\nendobj\n",
  );
  parts.push(`6 0 obj\n<< /Length ${page2Bytes.length} /Filter /ASCIIHexDecode >>\nstream\n`);
  parts.push(page2Bytes.toString("latin1"));
  parts.push("\nendstream\nendobj\n");
  parts.push(font);
  parts.push("trailer\n<< /Root 1 0 R /Size 8 >>\n%%EOF");
  return toFile(Buffer.from(parts.join(""), "latin1"), name);
}
