/**
 * Deterministic, dependency-free PDF text-layer extraction.
 *
 * HONESTY BOUNDARY (read before changing confidence thresholds): this is a
 * minimal, hand-written parser of the PDF content-stream text-showing
 * operators (Tj/TJ) inside FlateDecode-compressed streams — it is NOT a
 * spec-complete PDF interpreter. It does not resolve custom/CID font
 * encodings via ToUnicode CMaps, does not handle encrypted PDFs, and does
 * not walk the full object/xref graph (it scans for `stream ... endstream`
 * byte ranges directly, which finds the real content streams for the
 * overwhelming majority of PDFs produced by word processors and
 * "print to PDF" — the common case for typed judgments — but is not
 * guaranteed for every PDF producer). This module was written because no
 * PDF library (e.g. pdfjs-dist) can be installed in this project's sandbox
 * (`npm install` returns 403 — no registry access), and the explicit
 * instruction was "if a reliable text-layer PDF parser can be added
 * without introducing an unsafe/heavy/unmaintainable dependency, implement
 * it" using only what the browser already provides:
 * `DecompressionStream('deflate')` (the Web Compression Streams API,
 * baseline-available in modern browsers — Chrome/Edge 80+, Firefox 113+,
 * Safari 16.4+) for zlib/FlateDecode inflation, and plain string/regex
 * scanning for everything else.
 *
 * Because this cannot be verified as spec-complete, it self-reports
 * confidence rather than ever asserting success: `hasTextLayer` and
 * `text` are only populated when the extracted content passes a
 * readable-character-ratio sanity check; otherwise `requiresOcr: true` is
 * returned and the caller must fall back to asking the curator to paste
 * text. This module NEVER claims OCR — an image-only/scanned PDF (no
 * FlateDecode text stream produced any readable text) is reported as
 * requiring OCR, not silently treated as empty or as a failure to guess.
 */

export interface PdfExtractionResult {
  /** Best-effort extracted text, in approximate document order. Empty string if none could be confidently extracted. */
  text: string;
  /** True only when `text` is non-empty AND passed the readable-character confidence check. */
  hasTextLayer: boolean;
  /** True when no confident text layer was found — the PDF is likely scanned/image-only, or uses an encoding this parser cannot resolve. Never true at the same time as hasTextLayer. */
  requiresOcr: boolean;
  /** Diagnostic only, not shown to the curator as a hard guarantee. */
  streamsFound: number;
  textStreamsDecoded: number;
}

const MIN_CONFIDENT_CHARS = 80;
const MIN_READABLE_RATIO = 0.85;

/**
 * Attempts deterministic text-layer extraction from a PDF File. Never
 * throws for a normal (even non-text-bearing) PDF — extraction failure is
 * communicated via `requiresOcr: true`, not an exception. Throws only if
 * the browser lacks `DecompressionStream` entirely (checked by the
 * caller via `isPdfExtractionSupported()` first) or the file cannot be
 * read at all.
 */
export async function extractPdfTextLayer(file: File): Promise<PdfExtractionResult> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  // Byte-for-byte "latin1" string view: one byte maps to exactly one JS
  // UTF-16 code unit (0-255), preserving exact byte offsets so a string
  // index can be used directly as a Uint8Array index below. This is the
  // standard technique for scanning arbitrary binary data with string
  // regex/indexOf without corrupting it (unlike UTF-8 decoding, which
  // would mangle raw PDF bytes that aren't valid UTF-8).
  const raw = new TextDecoder("iso-8859-1").decode(bytes);

  const streamRanges = findStreamByteRanges(raw);
  let textStreamsDecoded = 0;
  const textChunks: string[] = [];

  for (const range of streamRanges) {
    const precedingDict = raw.slice(Math.max(0, range.dictStart), range.start);
    // Skip streams that are declared as images regardless of filter — a
    // /Subtype /Image dictionary is never a text content stream.
    if (precedingDict.includes("/Subtype/Image") || precedingDict.includes("/Subtype /Image")) continue;
    // Skip streams declared with a known image-only compression filter
    // (no text content stream ever uses these).
    if (
      precedingDict.includes("/DCTDecode") ||
      precedingDict.includes("/CCITTFaxDecode") ||
      precedingDict.includes("/JPXDecode") ||
      precedingDict.includes("/JBIG2Decode")
    ) {
      continue;
    }

    const isFlate = precedingDict.includes("/FlateDecode");
    // Streams that declare no filter at all are also legitimate content
    // streams for some PDF producers (uncompressed output) — attempt
    // direct text-operator extraction on the raw bytes in that case
    // rather than assuming every unfiltered stream must be binary image
    // data (already excluded above via /Subtype /Image and the known
    // image filters).
    const hasAnyFilter = precedingDict.includes("/Filter");
    if (!isFlate && hasAnyFilter) continue; // unrecognized filter (e.g. LZW, RunLength) — skip rather than guess

    try {
      let content: string;
      if (isFlate) {
        const rawStreamBytes = bytes.subarray(range.start, range.end);
        const inflated = await inflateZlib(rawStreamBytes);
        content = new TextDecoder("iso-8859-1").decode(inflated);
      } else {
        content = raw.slice(range.start, range.end);
      }
      const extracted = extractTextFromContentStream(content);
      if (extracted.trim()) {
        textStreamsDecoded += 1;
        textChunks.push(extracted);
      }
    } catch {
      // Not actually valid zlib/Flate data (e.g. a mis-detected filter
      // match, or a stream that references FlateDecode in an unrelated
      // part of a compound dictionary) — skip silently, this is a
      // best-effort scan, not a guaranteed-correct parser.
      continue;
    }
  }

  const combined = normalizeExtractedText(textChunks.join("\n"));
  const confidence = assessConfidence(combined);

  return {
    text: confidence.confident ? combined : "",
    hasTextLayer: confidence.confident,
    requiresOcr: !confidence.confident,
    streamsFound: streamRanges.length,
    textStreamsDecoded,
  };
}

export function isPdfExtractionSupported(): boolean {
  return typeof DecompressionStream !== "undefined";
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface StreamRange {
  /** Where the search window for this stream's own dictionary should start (bounded backward scan, not full object parsing). */
  dictStart: number;
  start: number;
  end: number;
}

/** Scans for every `stream ... endstream` byte range in the raw latin1 view. Does not parse the PDF object/xref graph — a direct byte scan, which finds real content streams for the vast majority of producers. */
function findStreamByteRanges(raw: string): StreamRange[] {
  const ranges: StreamRange[] = [];
  const streamKw = "stream";
  const endKw = "endstream";
  let searchFrom = 0;
  const n = raw.length;

  while (searchFrom < n) {
    const kwIdx = raw.indexOf(streamKw, searchFrom);
    if (kwIdx === -1) break;
    // Guard against matching the "stream" inside "endstream" from a
    // previous iteration's leftover search position, and against
    // matching mid-identifier (e.g. some future keyword containing
    // "stream") by requiring a non-letter before it.
    const before = kwIdx > 0 ? raw[kwIdx - 1] : " ";
    if (/[A-Za-z]/.test(before)) {
      searchFrom = kwIdx + streamKw.length;
      continue;
    }

    let dataStart = kwIdx + streamKw.length;
    if (raw[dataStart] === "\r" && raw[dataStart + 1] === "\n") dataStart += 2;
    else if (raw[dataStart] === "\n") dataStart += 1;
    else if (raw[dataStart] === "\r") dataStart += 1;

    const endIdx = raw.indexOf(endKw, dataStart);
    if (endIdx === -1) break;

    let dataEnd = endIdx;
    if (raw[dataEnd - 1] === "\n") {
      dataEnd -= 1;
      if (raw[dataEnd - 1] === "\r") dataEnd -= 1;
    } else if (raw[dataEnd - 1] === "\r") {
      dataEnd -= 1;
    }

    ranges.push({ dictStart: Math.max(0, kwIdx - 2000), start: dataStart, end: dataEnd });
    searchFrom = endIdx + endKw.length;
  }

  return ranges;
}

/** Inflates zlib/FlateDecode-compressed bytes using the Web Compression Streams API (`'deflate'` = zlib-wrapped DEFLATE, matching PDF's FlateDecode filter exactly — not `'deflate-raw'`). */
async function inflateZlib(input: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate");
  // `.slice()` copies into a plain, freshly-allocated ArrayBuffer-backed
  // Uint8Array — `subarray()` (used by the caller) instead returns a view
  // whose backing buffer type TypeScript's DOM lib no longer widens to the
  // `BlobPart` union, so passing it directly to `Blob()` fails to compile.
  const stream = new Blob([input.slice()]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Extracts visible text from one decompressed content stream by scanning
 * for the PDF text-showing operators `Tj` (single literal string) and
 * `TJ` (array of strings/kerning numbers), plus `Td`/`TD`/`T*` (text
 * position moves, treated as line breaks — a heuristic, not true layout
 * reconstruction). Hex strings (`<...>Tj`, used by some embedded/CID
 * fonts) are deliberately NOT decoded — without the font's ToUnicode
 * CMap, decoding hex glyph codes as characters produces silently wrong
 * text, which is worse than omitting it; a PDF that stores all its text
 * as hex strings will correctly fall through to a low-confidence result
 * below rather than emit garbage.
 */
// Kerning/advance adjustments inside a `TJ` array are expressed in
// thousandths of a text-space unit; real PDF producers commonly emit a
// value in roughly this range specifically to open up a word gap that
// isn't otherwise represented by a literal space character. This
// threshold is a heuristic (used by other minimal text extractors for
// the same purpose), not a spec requirement.
const TJ_WORD_GAP_THRESHOLD = -80;

function extractTextFromContentStream(content: string): string {
  const out: string[] = [];
  const n = content.length;
  let i = 0;
  let arrayDepth = 0;

  while (i < n) {
    const ch = content[i];

    if (ch === "[") {
      arrayDepth += 1;
      i += 1;
      continue;
    }
    if (ch === "]") {
      arrayDepth = Math.max(0, arrayDepth - 1);
      i += 1;
      continue;
    }

    if (ch === "(") {
      const { value, endIndex } = scanLiteralString(content, i);
      // Only keep it if followed (after whitespace/array punctuation) by
      // a text-showing context -- but tracking full array vs. bare Tj
      // context precisely requires a real tokenizer; as a pragmatic
      // middle ground we keep every parenthesized string found in the
      // stream. Non-text parenthesized operands are rare relative to
      // actual text runs in a typical content stream, and the
      // confidence check downstream catches streams where this
      // assumption fails badly.
      out.push(unescapePdfLiteral(value));
      i = endIndex;
      continue;
    }

    if (matchesWordOp(content, i, "Td") || matchesWordOp(content, i, "TD") || matchesWordOp(content, i, "T*")) {
      out.push("\n");
      i += 2;
      continue;
    }

    // A bare kerning/advance number between two strings inside a TJ
    // array -- e.g. `[(Citation:) -250 (\(1973\))] TJ`. A sufficiently
    // negative value indicates the producer opened up a word-sized gap
    // rather than just tightening letter spacing; insert a space so
    // "Citation:(1973)" doesn't get silently glued into one token.
    if (arrayDepth > 0 && (ch === "-" || (ch >= "0" && ch <= "9"))) {
      const numMatch = /^-?\d+(\.\d+)?/.exec(content.slice(i));
      if (numMatch) {
        const val = parseFloat(numMatch[0]);
        if (val <= TJ_WORD_GAP_THRESHOLD && out.length > 0 && !out[out.length - 1].endsWith(" ")) {
          out.push(" ");
        }
        i += numMatch[0].length;
        continue;
      }
    }

    i += 1;
  }

  return out.join("");
}

function matchesWordOp(content: string, i: number, op: string): boolean {
  if (content.slice(i, i + op.length) !== op) return false;
  const before = i > 0 ? content[i - 1] : " ";
  const after = content[i + op.length] ?? " ";
  return /\s/.test(before) && (/\s/.test(after) || after === "");
}

/** Scans a PDF literal string starting at `s[start] === '('`, respecting escaped and balanced-unescaped parens per the PDF spec. Returns the raw (still-escaped) inner text and the index just past the closing paren. */
function scanLiteralString(s: string, start: number): { value: string; endIndex: number } {
  let depth = 1;
  let j = start + 1;
  let value = "";
  const n = s.length;
  while (j < n && depth > 0) {
    const c = s[j];
    if (c === "\\") {
      value += c + (s[j + 1] ?? "");
      j += 2;
      continue;
    }
    if (c === "(") {
      depth += 1;
      value += c;
      j += 1;
      continue;
    }
    if (c === ")") {
      depth -= 1;
      j += 1;
      if (depth === 0) break;
      value += c;
      continue;
    }
    value += c;
    j += 1;
  }
  return { value, endIndex: j };
}

/** Resolves PDF literal-string escapes: \\n \\r \\t \\b \\f \\( \\) \\\\ and octal \\ddd. */
function unescapePdfLiteral(escaped: string): string {
  let result = "";
  for (let i = 0; i < escaped.length; i++) {
    if (escaped[i] !== "\\") {
      result += escaped[i];
      continue;
    }
    const next = escaped[i + 1];
    if (next === "n") { result += "\n"; i += 1; continue; }
    if (next === "r") { result += "\r"; i += 1; continue; }
    if (next === "t") { result += "\t"; i += 1; continue; }
    if (next === "b") { result += "\b"; i += 1; continue; }
    if (next === "f") { result += "\f"; i += 1; continue; }
    if (next === "(" || next === ")" || next === "\\") { result += next; i += 1; continue; }
    if (next === "\n") { i += 1; continue; } // line continuation, no char emitted
    if (next >= "0" && next <= "7") {
      const octal = escaped.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)?.[0] ?? "";
      result += String.fromCharCode(parseInt(octal, 8) & 0xff);
      i += octal.length;
      continue;
    }
    result += next ?? "";
    i += 1;
  }
  return result;
}

function normalizeExtractedText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/ +\n/g, "\n")
    .trim();
}

/**
 * Confidence gate: requires a minimum amount of extracted text AND a high
 * ratio of plausibly-readable characters (printable ASCII, common Latin
 * accented ranges, and whitespace). A garbled decode from an unsupported
 * font encoding tends to produce a low readable ratio (control characters,
 * private-use-area glyph codes) and fails this check, which is what
 * routes the caller to "OCR required / paste text" instead of proposing
 * garbage metadata.
 */
function assessConfidence(text: string): { confident: boolean; readableRatio: number } {
  if (text.length < MIN_CONFIDENT_CHARS) return { confident: false, readableRatio: 0 };
  let readable = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const isReadable =
      (code >= 0x20 && code <= 0x7e) || // printable ASCII
      code === 0x0a ||
      code === 0x09 ||
      (code >= 0xa0 && code <= 0x24f); // Latin-1 supplement + Latin Extended-A/B (accented characters)
    if (isReadable) readable += 1;
  }
  const ratio = readable / text.length;
  return { confident: ratio >= MIN_READABLE_RATIO, readableRatio: ratio };
}
