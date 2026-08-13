/**
 * Deterministic, dependency-free PDF text-layer extraction.
 *
 * HONESTY BOUNDARY (read before changing confidence thresholds): this is a
 * minimal, hand-written parser of the PDF content-stream text-showing
 * operators (Tj/TJ) inside FlateDecode-compressed streams — it is NOT a
 * spec-complete PDF interpreter. It does not resolve CID/composite-font
 * text via ToUnicode CMaps (SIMPLE-font hex-string operands ARE decoded —
 * see decodeHexOperand below — but a hex operand belonging to a detected
 * Type0/CID font is deliberately left undecoded rather than guessed), does
 * not handle encrypted PDFs (detected and reported as a specific reason,
 * never silently attempted), and does not walk the full object/xref graph
 * (it scans for `stream ... endstream` byte ranges directly, which finds
 * the real content streams for the overwhelming majority of PDFs produced
 * by word processors and "print to PDF" — the common case for typed
 * judgments — but is not guaranteed for every PDF producer). This module
 * was written because no
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
 *
 * IMPORTANT — this module's own `hasTextLayer`/`requiresOcr` gate is a
 * cheap, single-document sanity check, NOT the authoritative quality
 * decision for the ingestion pipeline. `src/lib/extraction-quality.ts`
 * runs a stricter, document-agnostic assessment (font/licensing
 * boilerplate detection, replacement-character ratio, repeated-glyph
 * detection, etc.) on whatever this module returns, and
 * `src/lib/extraction-pipeline.ts` is the only place callers should treat
 * as authoritative for "was this actually usable text." Real historical
 * PDFs (see that pipeline's file header) showed this module's own gate
 * alone was not sufficient — e.g. embedded font-license text is legitimate,
 * highly "readable" ASCII by this module's own metric, yet is not
 * judgment content at all.
 *
 * This module also has NO object-graph awareness — it does not know
 * which streams are actually referenced by a Page's /Contents. It scans
 * every `stream ... endstream` byte range in the file and filters out the
 * kinds of non-content streams identified as false-positive sources
 * during a real-PDF audit (compressed object streams, cross-reference
 * streams, XMP metadata, embedded font program data — see the exclusion
 * list in the main loop below). This measurably reduces, but does not
 * eliminate, the risk of extracting non-content text from an
 * unanticipated stream type; the quality gate downstream is the backstop
 * for whatever this heuristic still lets through.
 */

export interface PdfPageResult {
  /** 1-based, matching how curators/judgments refer to page numbers ("at page 4"), never 0-based. */
  pageNumber: number;
  text: string;
  characterCount: number;
}

/**
 * WHY nothing usable was extracted (only meaningful when `hasTextLayer` is
 * false) — added during the "SIMPLE AND TIGHT" ingestion pass specifically
 * so the pipeline/UI can give an honest, SPECIFIC reason instead of
 * lumping every non-extraction under one generic "OCR required" message.
 * This is diagnostic, not a new top-level status: `requiresOcr` remains
 * the single bucket a downstream caller branches on (no enum explosion),
 * this field only changes what reason text is shown.
 *   - "encrypted": the PDF declares an `/Encrypt` entry (owner-password/
 *     permissions-restricted PDFs commonly open and display fine with no
 *     password prompt, yet every content stream's bytes are encrypted —
 *     this parser has no decryption, so it correctly reports nothing
 *     rather than attempting to inflate encrypted bytes as if they were
 *     plain FlateDecode data).
 *   - "unsupported_font_encoding": text-showing operators exist and use
 *     hex-string operands (`<...> Tj`/`TJ`), but the file also declares a
 *     composite/Type0 (CID-keyed) font — decoding hex bytes as characters
 *     in that case would silently produce WRONG text (CID codes are not
 *     character codes without the font's CMap), so this parser correctly
 *     declines rather than guess. This is genuinely a different situation
 *     from "no text layer at all" and is worth saying so.
 *   - "no_text_found": no text-showing operators produced any confident
 *     text at all — consistent with (but not provably confirming) a
 *     scanned/image-only document; the honest, most common case.
 *   - null: a text layer WAS found (hasTextLayer is true) — this field is
 *     only populated on the failure path.
 */
export type PdfUnreadableReason = "encrypted" | "unsupported_font_encoding" | "no_text_found";

export interface PdfExtractionResult {
  /** Best-effort extracted text, in approximate document order. Empty string if none could be confidently extracted. Equal to `pages` joined with a page-boundary separator. */
  text: string;
  /** True only when `text` is non-empty AND passed the readable-character confidence check. */
  hasTextLayer: boolean;
  /** True when no confident text layer was found — the PDF is likely scanned/image-only, or uses an encoding this parser cannot resolve. Never true at the same time as hasTextLayer. */
  requiresOcr: boolean;
  /** See PdfUnreadableReason. Always null when hasTextLayer is true. */
  unreadableReason: PdfUnreadableReason | null;
  /** Diagnostic only, not shown to the curator as a hard guarantee. */
  streamsFound: number;
  textStreamsDecoded: number;
  /**
   * Page-aware breakdown (Task 5: "PRODUCTION DOCUMENT INGESTION PHASE").
   * HONESTY BOUNDARY: this parser has no real object-graph/xref awareness
   * (see the module header) — it cannot resolve a Page object's /Contents
   * reference(s) authoritatively. Page attribution here is a documented
   * heuristic (see findPageMarkerOffsets below): it locates `/Type /Page`
   * dictionary occurrences in file-byte order and attributes each
   * surviving content stream to the most recent one before it. This holds
   * for the common case (a page's own dictionary is emitted immediately
   * before its content stream — true of essentially every word-processor/
   * "print to PDF" producer), but is NOT guaranteed for every PDF
   * producer (e.g. one that groups all page dictionaries via compressed
   * object streams separately from content streams). When zero `/Type
   * /Page` markers are found at all, every extracted stream is attributed
   * to a single implicit page 1 — this is what makes this heuristic 100%
   * backward compatible with every existing single-page-shaped fixture
   * and is a safe, honest fallback rather than a guess.
   */
  pages: PdfPageResult[];
  /** Number of `/Type /Page` markers found (>= 1 whenever any text was extracted — see the implicit-page-1 fallback above). 0 only when nothing was extracted at all. */
  pageCount: number;
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

  // Encryption check (SIMPLE AND TIGHT ingestion pass): a document
  // dictionary key, not free text — `/Encrypt` essentially never appears
  // in a PDF for any other reason, so a plain substring check is safe and
  // bounded. Checked once, up front, rather than per-stream: an encrypted
  // PDF's content streams would still declare /FlateDecode but their
  // bytes are cipher output, not zlib data — attempting to inflate them
  // would just throw and be silently skipped by the per-stream catch
  // below, indistinguishable from "no text at all" without this check.
  const isEncrypted = /\/Encrypt\b/.test(raw);

  // Composite/CID-keyed (Type0) font detection — a file-level signal, not
  // per-stream, since a content stream's own bytes give no indication of
  // which font a hex-string text operand is being shown in without
  // resolving the font resource dictionary (which this parser does not
  // do). A PDF that declares ANY composite font is treated conservatively
  // for ALL its hex-string operands, rather than trying to prove which
  // specific stream uses which specific font — see decodeHexOperand.
  const hasCompositeFont = /\/Subtype\s*\/Type0\b/.test(raw) || /\/Encoding\s*\/Identity-H\b/.test(raw);

  const streamRanges = findStreamByteRanges(raw);
  const pageMarkerOffsets = findPageMarkerOffsets(raw);
  let textStreamsDecoded = 0;
  let hexOperandsSkipped = 0;
  // Bucketed by page index (0-based) rather than one flat array — see
  // PdfExtractionResult.pages for the attribution heuristic.
  const pageChunks: string[][] = pageMarkerOffsets.length > 0 ? pageMarkerOffsets.map(() => []) : [[]];

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
    // Root-cause fix (real-PDF audit, "REAL CASE LAW PDF METADATA
    // EXTRACTION REPAIR PASS"): this parser has no object-graph awareness
    // — it scans every `stream ... endstream` byte range in the file, not
    // just streams actually referenced as a Page's /Contents. Several
    // OTHER kinds of FlateDecode-compressed streams are common in real
    // PDF producers and are NOT page text, but decompress to bytes that
    // can still contain "(" / ")" characters and pass the naive Tj/TJ
    // scan below, producing exactly the observed "irrelevant embedded
    // font/licensing material" and PDF-internal garbage:
    //   - /Type /ObjStm (a "compressed object stream" holding OTHER PDF
    //     objects' dictionary syntax — PDF 1.5+ producers use these
    //     heavily; scanning one for literal strings extracts PDF syntax,
    //     not document text).
    //   - /Type /XRef (compressed cross-reference stream — pure binary
    //     offset tables, never text).
    //   - /Type /Metadata (XMP metadata packets — often DO contain
    //     genuine, readable text, but it's copyright/license/producer
    //     boilerplate about the PDF file itself, never the judgment).
    //   - Embedded font PROGRAM data (the actual glyph outline binary,
    //     as opposed to a font's ToUnicode CMap) — reliably identified by
    //     /Length1 (a key that, per the PDF spec, only ever appears on a
    //     FontFile stream dictionary) or a /Subtype naming an embedded
    //     font program format.
    // None of these are page content; excluding them removes an entire
    // class of false-positive "extraction" before the text even reaches
    // the confidence gate below.
    if (
      precedingDict.includes("/Type/ObjStm") || precedingDict.includes("/Type /ObjStm") ||
      precedingDict.includes("/Type/XRef") || precedingDict.includes("/Type /XRef") ||
      precedingDict.includes("/Type/Metadata") || precedingDict.includes("/Type /Metadata") ||
      precedingDict.includes("/Length1") ||
      precedingDict.includes("/Subtype/Type1C") || precedingDict.includes("/Subtype /Type1C") ||
      precedingDict.includes("/Subtype/CIDFontType0C") || precedingDict.includes("/Subtype /CIDFontType0C") ||
      precedingDict.includes("/Subtype/OpenType") || precedingDict.includes("/Subtype /OpenType")
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
      // Defense-in-depth exclusion (Task 4 root-cause fix): a PDF's
      // ToUnicode CMap stream carries NO distinguishing /Type or /Subtype
      // marker of its own (unlike a font PROGRAM stream, which has
      // /Length1 — see the dict-based exclusions above), so it cannot be
      // filtered out before decompression. Once decompressed, though, a
      // CMap stream is unambiguous: it is Adobe's CMap resource format,
      // always containing the literal PostScript-like keywords
      // "begincmap"/"endcmap" per the PDF spec (ISO 32000-1 §9.7.5.3) —
      // this is true for EVERY PDF that embeds a ToUnicode CMap,
      // regardless of jurisdiction/document/font, so checking for it here
      // is a generic structural exclusion, not a fixture-specific one.
      // This is what a real-world CMap stream looks like inside:
      //   /CIDInit /ProcSet findresource begin
      //   12 dict begin begincmap
      //   /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS2) ... >> def
      //   ... endcmap end end
      // The literal strings "(Adobe)" / "(UCS2)" above are genuine PDF
      // literal-string syntax (not any different from Tj text), so the
      // Tj/TJ-operand check below is not by itself sufficient to exclude
      // this whole stream type early — this check is the primary
      // defense for it.
      if (content.includes("begincmap") || content.includes("/CIDSystemInfo")) {
        continue;
      }
      const result = extractTextFromContentStream(content, !hasCompositeFont);
      hexOperandsSkipped += result.hexOperandsSkipped;
      if (result.text.trim()) {
        textStreamsDecoded += 1;
        const pageIndex = resolvePageIndex(pageMarkerOffsets, range.start);
        pageChunks[pageIndex].push(result.text);
      }
    } catch {
      // Not actually valid zlib/Flate data (e.g. a mis-detected filter
      // match, or a stream that references FlateDecode in an unrelated
      // part of a compound dictionary) — skip silently, this is a
      // best-effort scan, not a guaranteed-correct parser.
      continue;
    }
  }

  const pages: PdfPageResult[] = pageChunks.map((chunks, i) => {
    const text = normalizeExtractedText(chunks.join("\n"));
    return { pageNumber: i + 1, text, characterCount: text.length };
  });
  // A clear, unambiguous page-boundary separator (never produced by
  // normalizeExtractedText itself, which collapses 3+ newlines down to 2)
  // — this is what prevents the reported "138Page 4 of 72DPP v Beard"
  // class of gluing from happening AT PAGE BOUNDARIES specifically (the
  // within-page gluing is handled separately by the word-boundary
  // spacing heuristic in extractTextFromContentStream).
  const combined = normalizeExtractedText(pages.map((p) => p.text).join("\n\n"));
  const confidence = assessConfidence(combined);

  // Reason precedence when nothing confident was extracted: encryption is
  // checked first (it structurally prevents reading ANY content stream, so
  // it's the most specific and most actionable explanation when present);
  // then undecoded composite-font hex operands (a genuine text layer this
  // parser specifically can't decode, as opposed to no text layer at all);
  // then the honest default.
  let unreadableReason: PdfUnreadableReason | null = null;
  if (!confidence.confident) {
    unreadableReason = isEncrypted ? "encrypted" : hexOperandsSkipped > 0 ? "unsupported_font_encoding" : "no_text_found";
  }

  return {
    text: confidence.confident ? combined : "",
    hasTextLayer: confidence.confident,
    requiresOcr: !confidence.confident,
    unreadableReason,
    streamsFound: streamRanges.length,
    textStreamsDecoded,
    pages: confidence.confident ? pages.filter((p) => p.text.length > 0) : [],
    pageCount: confidence.confident ? pages.length : 0,
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

/**
 * Locates every `/Type /Page` dictionary marker in file-byte order —
 * deliberately excluding `/Type /Pages` (the page TREE node, matched via
 * a negative lookahead so `/Type /Page` doesn't also match the "Page" in
 * "Pages"). This is the page-attribution heuristic's only signal (see
 * PdfExtractionResult.pages for the full honesty disclaimer): it does NOT
 * resolve indirect object references, so it cannot prove which content
 * stream belongs to which page — it relies on the near-universal
 * real-world PDF producer pattern of emitting a page's own dictionary
 * immediately before that page's content stream.
 */
function findPageMarkerOffsets(raw: string): number[] {
  const offsets: number[] = [];
  const re = /\/Type\s*\/Page(?!s)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    offsets.push(m.index);
    if (offsets.length > 5000) break; // safety cap against pathological input
  }
  return offsets;
}

/** Given the sorted `/Type /Page` marker offsets and a stream's start offset, returns the 0-based index of the page whose marker most recently precedes the stream (clamped to the last page if the stream comes after all markers; attributed to page 0 if it comes before all of them — e.g. a stray stream ahead of any page dictionary). Returns 0 unconditionally when there are no markers at all (single implicit page). */
function resolvePageIndex(pageMarkerOffsets: number[], streamStart: number): number {
  if (pageMarkerOffsets.length === 0) return 0;
  let index = 0;
  for (let i = 0; i < pageMarkerOffsets.length; i++) {
    if (pageMarkerOffsets[i] <= streamStart) index = i;
    else break;
  }
  return index;
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
 * reconstruction). Hex strings (`<...>Tj`/`TJ`) are now decoded, but ONLY
 * when `decodeHex` is true (the caller passes `!hasCompositeFont` — see
 * extractPdfTextLayer) — for a SIMPLE font, a hex string is just an
 * alternate encoding of the same one-byte-per-character text a literal
 * string would carry, so decoding it the identical way is safe. For a
 * composite/Type0 (CID-keyed) font, a hex string's bytes are glyph/CID
 * codes, not character codes — decoding them without the font's ToUnicode
 * CMap would produce silently WRONG text, which is worse than omitting
 * it, so `decodeHex=false` counts and skips them instead of guessing.
 */
// Kerning/advance adjustments inside a `TJ` array are expressed in
// thousandths of a text-space unit; real PDF producers commonly emit a
// value in roughly this range specifically to open up a word gap that
// isn't otherwise represented by a literal space character. This
// threshold is a heuristic (used by other minimal text extractors for
// the same purpose), not a spec requirement.
const TJ_WORD_GAP_THRESHOLD = -80;

/**
 * ARCHITECTURAL FIX (Task 4, false-success prevention): the previous
 * version of this function kept EVERY parenthesized literal string found
 * anywhere in an eligible stream, on the stated theory that "non-text
 * parenthesized operands are rare" — a real Ramsingh-class PDF proved that
 * assumption wrong (a ToUnicode CMap's `/Registry (Adobe) /Ordering
 * (UCS2)` literal-string dictionary values are genuine PDF literal-string
 * syntax, extracted verbatim as "AdobeUCS2" text). This version only
 * keeps a literal string when it is a CONFIRMED operand of a real
 * text-showing operator — `Tj` for a bare literal, or `TJ` for an array —
 * by buffering candidates and only committing them once the operator that
 * follows is actually seen. Nothing about this is document/jurisdiction-
 * specific: it is a correctness fix to PDF operator parsing that applies
 * identically to every PDF this parser ever processes.
 */
function extractTextFromContentStream(
  content: string,
  decodeHex: boolean,
): { text: string; hexOperandsSkipped: number } {
  const out: string[] = [];
  const n = content.length;
  let i = 0;
  let arrayDepth = 0;
  let hexOperandsSkipped = 0;
  // Non-null only while arrayDepth > 0 -- literals collected here are
  // committed to `out` only if the array's closing `]` is immediately
  // followed by `TJ`; otherwise the whole buffer is discarded (the array
  // was some other operator's operand, e.g. a dash pattern for `d`).
  let arrayBuffer: string[] | null = null;

  while (i < n) {
    const ch = content[i];

    if (ch === "[") {
      arrayDepth += 1;
      if (arrayDepth === 1) arrayBuffer = [];
      i += 1;
      continue;
    }
    if (ch === "]") {
      arrayDepth = Math.max(0, arrayDepth - 1);
      i += 1;
      if (arrayDepth === 0 && arrayBuffer !== null) {
        const afterOp = peekOperator(content, i, "TJ");
        if (afterOp !== null) {
          for (const t of arrayBuffer) pushWithSpacingHeuristic(out, t);
          i = afterOp;
        }
        // else: not TJ-terminated -- discard, never treated as text.
        arrayBuffer = null;
      }
      continue;
    }

    if (ch === "(") {
      const { value, endIndex } = scanLiteralString(content, i);
      const text = unescapePdfLiteral(value);
      if (arrayDepth > 0 && arrayBuffer !== null) {
        // Provisional -- only kept if the enclosing array turns out to be
        // a genuine TJ operand (checked above at the matching `]`).
        arrayBuffer.push(text);
        i = endIndex;
        continue;
      }
      // Bare (non-array) literal -- only a confirmed `Tj` operand is kept.
      // A literal NOT followed by Tj (e.g. a dictionary value inside
      // embedded CMap/PostScript-like stream syntax, or any other
      // operator's string operand) is never document text and must not
      // leak into the extracted result, no matter how readable it looks.
      const afterOp = peekOperator(content, endIndex, "Tj");
      if (afterOp !== null) {
        pushWithSpacingHeuristic(out, text);
        i = afterOp;
        continue;
      }
      i = endIndex;
      continue;
    }

    // Hex string operand (`<48656C6C6F> Tj` / inside a TJ array). Only
    // decoded when `decodeHex` is true (no composite/Type0 font detected
    // anywhere in this file — see the module header and
    // extractPdfTextLayer) — otherwise every hex operand's bytes are
    // skipped and merely counted, never guessed at as characters, exactly
    // mirroring the confirmed-operand discipline literal strings already
    // follow (only a genuine Tj/TJ operand is ever treated as text).
    if (ch === "<" && content[i + 1] !== "<") {
      const { value, endIndex } = scanHexString(content, i);
      const isProvisionalArrayMember = arrayDepth > 0 && arrayBuffer !== null;
      const afterOp = isProvisionalArrayMember ? null : peekOperator(content, endIndex, "Tj");
      const isConfirmedBareOperand = !isProvisionalArrayMember && afterOp !== null;
      if (isProvisionalArrayMember || isConfirmedBareOperand) {
        if (decodeHex) {
          const text = decodeHexOperand(value);
          if (isProvisionalArrayMember) {
            arrayBuffer!.push(text);
          } else {
            pushWithSpacingHeuristic(out, text);
          }
        } else {
          hexOperandsSkipped += 1;
        }
        i = isConfirmedBareOperand ? (afterOp as number) : endIndex;
        continue;
      }
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
    // Buffered into arrayBuffer (not `out` directly) for the same reason
    // as the literals above -- it must not survive if the array isn't
    // actually a TJ operand.
    if (arrayDepth > 0 && arrayBuffer !== null && (ch === "-" || (ch >= "0" && ch <= "9"))) {
      const numMatch = /^-?\d+(\.\d+)?/.exec(content.slice(i));
      if (numMatch) {
        const val = parseFloat(numMatch[0]);
        if (val <= TJ_WORD_GAP_THRESHOLD && arrayBuffer.length > 0 && !arrayBuffer[arrayBuffer.length - 1].endsWith(" ")) {
          arrayBuffer.push(" ");
        }
        i += numMatch[0].length;
        continue;
      }
    }

    i += 1;
  }

  return { text: out.join(""), hexOperandsSkipped };
}

function matchesWordOp(content: string, i: number, op: string): boolean {
  if (content.slice(i, i + op.length) !== op) return false;
  const before = i > 0 ? content[i - 1] : " ";
  const after = content[i + op.length] ?? " ";
  return /\s/.test(before) && (/\s/.test(after) || after === "");
}

/**
 * Skips whitespace starting at `from` and checks whether the operator
 * `op` (e.g. "Tj", "TJ") appears there as a genuine token (word-bounded,
 * not a prefix of a longer identifier). Returns the index just past the
 * operator if matched, or null otherwise. This is what turns "keep every
 * parenthesized string" into "keep only confirmed text-showing operands"
 * — the core of this pass's false-success fix.
 */
function peekOperator(content: string, from: number, op: string): number | null {
  let j = from;
  const n = content.length;
  while (j < n && /\s/.test(content[j])) j += 1;
  if (content.slice(j, j + op.length) !== op) return null;
  const after = content[j + op.length] ?? " ";
  if (/[A-Za-z0-9]/.test(after)) return null;
  return j + op.length;
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

/**
 * Scans a PDF hex string starting at `s[start] === '<'` (already confirmed
 * not to be `<<`, a dictionary open, by the caller). Per the PDF spec, hex
 * strings may contain whitespace between digit pairs and an odd trailing
 * digit is padded with an implicit 0 — both handled here. Returns the raw
 * hex digits (whitespace stripped) and the index just past the closing
 * `>`. Does not decode the digits into characters — see decodeHexOperand,
 * called separately only once the caller has confirmed this is a genuine
 * Tj/TJ operand (mirroring scanLiteralString's own division of labor).
 */
function scanHexString(s: string, start: number): { value: string; endIndex: number } {
  let j = start + 1;
  const n = s.length;
  let digits = "";
  while (j < n && s[j] !== ">") {
    if (/[0-9A-Fa-f]/.test(s[j])) digits += s[j];
    j += 1;
  }
  if (j < n) j += 1; // consume the closing '>'
  return { value: digits, endIndex: j };
}

/**
 * Decodes a SIMPLE-font hex string's digits into characters — one byte
 * (two hex digits) per character, identical in spirit to how a literal
 * string's raw bytes are treated elsewhere in this file (both ultimately
 * pass through as Latin-1/WinAnsi-range code points; this parser has no
 * broader font-encoding table, matching its existing, documented,
 * disclosed scope). ONLY called when the caller has already established
 * decodeHex=true (no composite/Type0 font detected in this file) — never
 * called for a hex operand that might belong to a CID-keyed font, since
 * that would silently produce wrong text (see the module header and
 * extractTextFromContentStream's decodeHex parameter).
 */
function decodeHexOperand(hexDigits: string): string {
  const padded = hexDigits.length % 2 === 1 ? hexDigits + "0" : hexDigits;
  let out = "";
  for (let k = 0; k < padded.length; k += 2) {
    const byte = parseInt(padded.slice(k, k + 2), 16);
    if (!Number.isNaN(byte)) out += String.fromCharCode(byte);
  }
  return out;
}

/**
 * TEXT RECONSTRUCTION FIX (Task 5, "PRODUCTION DOCUMENT INGESTION
 * PHASE" — live-tested Ramsingh result showed "...(1973) 20 WIR 138,
 * (1973) 20 WIR 138Page 4 of 72DPP v Beard..."). Two adjacent Tj/TJ text
 * runs with no intervening Td/TD/T* (absolute-positioned text, common
 * when a producer repositions the cursor via a text matrix this parser
 * doesn't track) get concatenated with zero separation. Rather than
 * attempt full text-matrix tracking (a much larger undertaking with real
 * risk of new bugs), this applies a narrow, generic word-boundary
 * heuristic: when the shape of the junction strongly implies a lost
 * space — a digit immediately followed by a letter ("138Page", "72DPP"),
 * a letter immediately followed by a digit ("Page4"), or a lowercase
 * letter immediately followed by an uppercase one ("...inghOverview",
 * effectively camelCase, which does not occur in ordinary English legal
 * prose) — a single space is inserted. This never fires on ordinary
 * within-word or within-number text (no letter-letter or digit-digit
 * transition ever triggers it).
 */
function pushWithSpacingHeuristic(out: string[], text: string): void {
  if (out.length > 0 && text.length > 0) {
    const prev = out[out.length - 1];
    const lastChar = prev[prev.length - 1];
    const firstChar = text[0];
    if (lastChar && looksLikeMissingWordBoundary(lastChar, firstChar)) {
      out.push(" ");
    }
  }
  out.push(text);
}

function looksLikeMissingWordBoundary(a: string, b: string): boolean {
  const aIsDigit = /[0-9]/.test(a);
  const bIsDigit = /[0-9]/.test(b);
  const aIsLetter = /[A-Za-z]/.test(a);
  const bIsLetter = /[A-Za-z]/.test(b);
  const aIsLower = /[a-z]/.test(a);
  const bIsUpper = /[A-Z]/.test(b);
  if (aIsDigit && bIsLetter) return true;
  if (aIsLetter && bIsDigit) return true;
  if (aIsLower && bIsUpper) return true;
  return false;
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
