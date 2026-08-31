/**
 * Deterministic, document-agnostic extraction quality gate.
 *
 * A PDF containing thousands of extracted characters is not necessarily a
 * successful extraction — the real-PDF audit (White v R/The State, The
 * King v Osborne, Diaz v The State) showed the previous parser's own
 * internal 85%-"readable-ASCII" confidence check passed on text that was
 * actually embedded font/licensing metadata, because that boilerplate
 * text is itself perfectly readable ASCII — just not the judgment.
 *
 * This module runs a SEPARATE, stricter assessment on whatever text the
 * parser produced (after sanitization — see text-sanitize.ts), looking
 * for structural signals that the extracted text is not genuine prose,
 * regardless of what document it came from. It never checks for a
 * specific citation, court name, or party name — that would make it a
 * fixture-specific check, which is exactly what this pass exists to move
 * away from.
 */

export type QualityHardFailReason =
  | "too_short"
  | "repeated_running_header"
  | "printable_ratio"
  | "replacement_chars"
  | "boilerplate"
  | "control_chars"
  | "structural_incoherence";

/** Coarse, UI-facing quality bucket — deliberately just 3 values, never a precise percentage (PRODUCTION DOCUMENT INGESTION PHASE, Section 7: "Do not overwhelm the normal UI with technical scores"). */
export type QualityBucket = "good" | "fair" | "poor";

export interface QualityAssessment {
  /** 0-1. Not shown to the curator as a precise number — used only to choose between "extracted" and "low_quality". */
  score: number;
  passed: boolean;
  /** Set only when `passed` is false — used by the caller to decide between a "failed" (wrong content) vs. "requires_ocr" (nothing usable) status. */
  hardFailReason?: QualityHardFailReason;
  /**
   * Section 7: "Distinguish CHARACTER QUALITY from STRUCTURAL QUALITY
   * from METADATA CONFIDENCE" — these two are the first half of that
   * split (metadata confidence lives separately in legal-extraction.ts's
   * MetadataConfidence, since it depends on the metadata-extraction
   * heuristics, not the raw text). CHARACTER quality asks "are these the
   * right KIND of characters" (printable, few control/replacement
   * chars); STRUCTURAL quality asks "does this look like genuine
   * word-broken prose in reading order," independent of character
   * composition — the exact distinction that let the CMap-artifact false
   * success happen before this phase's fixes.
   */
  characterQuality: QualityBucket;
  structuralQuality: QualityBucket;
  warnings: string[];
  metrics: {
    length: number;
    printableRatio: number;
    replacementRatio: number;
    controlRatio: number;
    alphabeticRatio: number;
    whitespaceRatio: number;
    boilerplateMarkerHits: number;
    /**
     * STRUCTURAL dimension (Task 4, Phase 2 — deliberately separate from
     * the CHARACTER-level metrics above). A text can be composed entirely
     * of printable, readable characters and still be structurally
     * incoherent — not real prose in reading order at all (e.g. PDF
     * internal syntax, or, before this pass's pdf-text-extraction.ts fix,
     * a CMap dictionary's literal-string values glued together with no
     * word breaks). This measures the SHAPE of the text — average "word"
     * length and presence of ordinary sentence-ending punctuation —
     * independent of character composition. Document-agnostic: applies
     * identically to prose judgments and to more list/heading-heavy
     * legislative text.
     */
    avgWordLength: number;
    sentenceBoundaryCount: number;
    /**
     * Fraction of whitespace-delimited words that fall inside a 6-word
     * window repeated 4+ times across the document (digit runs normalized
     * first, so "Page 4 of 72" and "Page 9 of 72" hash identically). High
     * coverage means the "content" is mostly the same running header/
     * footer block recurring per page — genuine prose or legislative text
     * only has small, incidental repetition. See `computeRepeatedBlockCoverage`.
     */
    repeatedBlockCoverageRatio: number;
    /** Character length of the text remaining after every repeated-block
     * window is removed — the actual amount of non-boilerplate content. */
    distinctContentLength: number;
  };
}

const MIN_LENGTH = 200;
const MIN_PRINTABLE_RATIO = 0.85;
const MAX_REPLACEMENT_RATIO = 0.01;
const MAX_CONTROL_RATIO = 0.02;
const MIN_ALPHABETIC_RATIO = 0.35;
const CLEAN_SCORE_THRESHOLD = 0.75;

/** Below this, there isn't enough text to judge repeated-block coverage
 * confidently either way -- a short legitimate fragment can otherwise look
 * 100% "repeated" against itself. Deliberately equal to MIN_LENGTH (the
 * too_short gate above) rather than a higher value -- a gap between the
 * two thresholds is exactly how a short (~350-565 char) boilerplate-only
 * document with only 2-3 repeated page headers can clear too_short yet
 * never reach the repeated-block analysis at all (found via a real bulk
 * seed-legislation audit: several short Acts landed in that gap). */
const REPEATED_BLOCK_MIN_LENGTH = MIN_LENGTH;
const REPEATED_BLOCK_MIN_WORDS = 25;
/** A 6-word window recurring this many times or more is page furniture
 * (running header/footer), not incidental repetition in real prose. A
 * short document has fewer total pages, so fewer literal repeats occur
 * even when it IS boilerplate-only -- 3 (not a higher bar) keeps the
 * check meaningful down at REPEATED_BLOCK_MIN_LENGTH. */
const REPEATED_BLOCK_WINDOW_SIZE = 6;
const REPEATED_BLOCK_MIN_REPEATS = 3;
const REPEATED_BLOCK_HARD_FAIL_COVERAGE = 0.5;
const REPEATED_BLOCK_WARN_COVERAGE = 0.3;
const REPEATED_BLOCK_MIN_DISTINCT_CHARS = MIN_LENGTH;

/**
 * Generic markers of embedded PDF font/licensing metadata — curated to be
 * terms that would essentially never appear in the body of a legal
 * judgment, but commonly appear verbatim in font license text (SIL Open
 * Font License, Adobe font EULAs) or PDF-internal structural boilerplate.
 * Deliberately generic (not "Ramsingh"/"White"/"Osborne"/"Diaz" specific)
 * per the explicit instruction not to optimize for named fixtures.
 */
const BOILERPLATE_MARKERS = [
  "reserved font name",
  "sil open font license",
  "font software",
  "this license permits",
  "font license",
  "trademark claims",
  "embedded font",
  "adobe systems incorporated",
  "truetype",
  "opentype",
  "cidfont",
  "fontfile",
  "postscript name",
  "glyph",
  "cmap",
  "objstm",
  "xref stream",
];

/** Repeated missing-glyph / "tofu box" markers a broken font decode commonly produces. */
const BOX_GLYPH_RE = /[□❑❒�]/g;

/**
 * A "word" (whitespace-delimited token) longer than this essentially
 * never occurs in real prose or legislative text — even long compound/
 * technical terms rarely exceed this. Text whose AVERAGE token length
 * clears this bar is not word-broken text at all — a strong, generic
 * (jurisdiction/document-agnostic) signal that word-space characters were
 * never genuinely present in the source stream, only glued syntax.
 */
const MAX_PLAUSIBLE_AVG_WORD_LENGTH = 30;
/** A text this long that contains not one ordinary sentence-ending boundary AND has abnormal average word length is not coherent prose/legislative text. Length-gated so short/list-only fragments aren't penalized. */
const STRUCTURAL_CHECK_MIN_LENGTH = 400;

/** Character-level bucket from printable/control/replacement ratios alone — independent of structure. */
function classifyCharacterQuality(printableRatio: number, controlRatio: number, replacementRatio: number): QualityBucket {
  if (printableRatio < MIN_PRINTABLE_RATIO || controlRatio > MAX_CONTROL_RATIO || replacementRatio > MAX_REPLACEMENT_RATIO) {
    return "poor";
  }
  if (printableRatio >= 0.97 && controlRatio === 0 && replacementRatio === 0) return "good";
  return "fair";
}

/** Structural bucket from word-shape/sentence-boundary signals alone — independent of character composition (this is precisely the dimension a character-only gate cannot see). */
function classifyStructuralQuality(length: number, avgWordLength: number, sentenceBoundaryCount: number): QualityBucket {
  if (length < STRUCTURAL_CHECK_MIN_LENGTH) return "fair"; // too short to judge structure confidently either way
  if (avgWordLength > MAX_PLAUSIBLE_AVG_WORD_LENGTH) return "poor";
  if (sentenceBoundaryCount === 0) return "fair"; // readable words, but no confirmed sentence structure
  return "good";
}

/**
 * Detects "the same short passage recurs across page boundaries with
 * negligible other content" -- the shape of a scanned gazette/report's
 * running header and footer repeated on every page, distinct from the
 * font/license `BOILERPLATE_MARKERS` check above (which targets embedded
 * PDF metadata, not page furniture). Digit runs are normalized to a single
 * placeholder token first so "Page 4 of 72" and "Page 9 of 72" -- the same
 * header with only the page number/date changing -- hash identically.
 * Document-agnostic: a genuine judgment or Act with a small running
 * header/footer has low coverage; one whose extracted text IS the running
 * header/footer, repeated, has high coverage.
 */
function computeRepeatedBlockCoverage(text: string): { coverageRatio: number; distinctContentLength: number } {
  const normalized = text.toLowerCase().replace(/\d+/g, "#");
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length < REPEATED_BLOCK_MIN_WORDS || text.length < REPEATED_BLOCK_MIN_LENGTH) {
    return { coverageRatio: 0, distinctContentLength: text.length };
  }

  const windowCounts = new Map<string, number>();
  for (let i = 0; i + REPEATED_BLOCK_WINDOW_SIZE <= words.length; i++) {
    const window = words.slice(i, i + REPEATED_BLOCK_WINDOW_SIZE).join(" ");
    windowCounts.set(window, (windowCounts.get(window) ?? 0) + 1);
  }

  const repeated = new Array<boolean>(words.length).fill(false);
  for (let i = 0; i + REPEATED_BLOCK_WINDOW_SIZE <= words.length; i++) {
    const window = words.slice(i, i + REPEATED_BLOCK_WINDOW_SIZE).join(" ");
    if ((windowCounts.get(window) ?? 0) >= REPEATED_BLOCK_MIN_REPEATS) {
      for (let j = i; j < i + REPEATED_BLOCK_WINDOW_SIZE; j++) repeated[j] = true;
    }
  }

  const repeatedWordCount = repeated.filter(Boolean).length;
  const coverageRatio = repeatedWordCount / words.length;

  // Approximate distinct content length as the character length of the
  // non-repeated words (plus their trailing spaces) -- not exact relative
  // to the original text's whitespace/casing, but proportionally accurate
  // enough to distinguish "a few real sentences remain" from "nothing does".
  let distinctContentLength = 0;
  for (let i = 0; i < words.length; i++) {
    if (!repeated[i]) distinctContentLength += words[i].length + 1;
  }

  return { coverageRatio, distinctContentLength };
}

function classifyHardFailReason(
  length: number,
  printableRatio: number,
  replacementRatio: number,
  controlRatio: number,
  boilerplateHits: number,
  avgWordLength: number,
  repeatedBlock: { coverageRatio: number; distinctContentLength: number },
): QualityHardFailReason | undefined {
  if (length < MIN_LENGTH) return "too_short";
  // Deliberately keyed on the ABSOLUTE amount of non-repeated content, not
  // the coverage ratio alone -- found via a real bulk-import audit that a
  // long multi-page document can legitimately have a high repeated-header
  // ratio (a running header repeats on every page) while still containing
  // many thousands of characters of genuine distinct text. Ratio alone
  // hard-failed a 30,000-character Act with 10,000+ real characters just
  // because ~63% of its word count was page furniture. Only the case where
  // almost NOTHING distinct remains is a genuine "no real content" failure.
  if (repeatedBlock.distinctContentLength < REPEATED_BLOCK_MIN_DISTINCT_CHARS) {
    return "repeated_running_header";
  }
  if (boilerplateHits >= 2) return "boilerplate";
  if (replacementRatio > MAX_REPLACEMENT_RATIO) return "replacement_chars";
  if (controlRatio > MAX_CONTROL_RATIO) return "control_chars";
  if (printableRatio < MIN_PRINTABLE_RATIO) return "printable_ratio";
  if (length >= STRUCTURAL_CHECK_MIN_LENGTH && avgWordLength > MAX_PLAUSIBLE_AVG_WORD_LENGTH) return "structural_incoherence";
  return undefined;
}

/**
 * Assesses SANITIZED extracted text (run `sanitizeExtractedText` first —
 * this function does not itself remove anything, only measures). Never
 * requires a particular legal phrase, citation format, or court name —
 * every check here is structural/statistical, so it applies equally to a
 * Guyana judgment, a Privy Council judgment, or a piece of Legislation.
 */
export function assessExtractionQuality(text: string): QualityAssessment {
  const length = text.length;
  const warnings: string[] = [];

  if (length < MIN_LENGTH) {
    return {
      score: 0,
      passed: false,
      hardFailReason: "too_short",
      warnings: [`Extracted text is too short (${length} characters) to reliably represent a judgment or legislative document.`],
      characterQuality: "poor",
      structuralQuality: "poor",
      metrics: {
        length,
        printableRatio: 0,
        replacementRatio: 0,
        controlRatio: 0,
        alphabeticRatio: 0,
        whitespaceRatio: 0,
        boilerplateMarkerHits: 0,
        avgWordLength: 0,
        sentenceBoundaryCount: 0,
        repeatedBlockCoverageRatio: 0,
        distinctContentLength: 0,
      },
    };
  }

  let printable = 0;
  let control = 0;
  let alphabetic = 0;
  let whitespace = 0;
  const replacementCount = (text.match(BOX_GLYPH_RE) ?? []).length;

  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const isControl = code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d;
    if (isControl) control += 1;
    if (/\s/.test(ch)) whitespace += 1;
    if (/\p{L}/u.test(ch)) alphabetic += 1;
    const isPrintable =
      (code >= 0x20 && code <= 0x7e) ||
      code === 0x09 ||
      code === 0x0a ||
      code === 0x0d ||
      (code >= 0xa0 && code <= 0x2ff) || // Latin-1 Supplement + Latin Extended A/B
      (code >= 0x2000 && code <= 0x206f); // General Punctuation (smart quotes, dashes, etc.)
    if (isPrintable) printable += 1;
  }

  const printableRatio = printable / length;
  const controlRatio = control / length;
  const alphabeticRatio = alphabetic / length;
  const whitespaceRatio = whitespace / length;
  const replacementRatio = replacementCount / length;

  const lower = text.toLowerCase();
  const boilerplateMarkerHits = BOILERPLATE_MARKERS.filter((m) => lower.includes(m)).length;

  // Structural dimension — see the MAX_PLAUSIBLE_AVG_WORD_LENGTH comment
  // above for why this is a separate, content-agnostic check from the
  // character-level ratios above it.
  const words = text.split(/\s+/).filter(Boolean);
  const avgWordLength = words.length > 0 ? words.reduce((sum, w) => sum + w.length, 0) / words.length : 0;
  const sentenceBoundaryCount = (text.match(/[.!?](\s+[A-Z]|\s*$)/g) ?? []).length;
  const repeatedBlock = computeRepeatedBlockCoverage(text);

  if (printableRatio < MIN_PRINTABLE_RATIO) {
    warnings.push(
      `Only ${(printableRatio * 100).toFixed(0)}% of characters are printable/expected text, likely a garbled or binary-derived extraction.`,
    );
  }
  if (replacementRatio > MAX_REPLACEMENT_RATIO) {
    warnings.push("Contains repeated replacement/missing-glyph characters (�), indicating a font-decoding failure.");
  }
  if (controlRatio > MAX_CONTROL_RATIO) {
    warnings.push("Contains an unusually high proportion of control characters for prose text.");
  }
  if (alphabeticRatio < MIN_ALPHABETIC_RATIO) {
    warnings.push("Unusually low proportion of alphabetic content for a legal document.");
  }
  if (whitespaceRatio < 0.05 || whitespaceRatio > 0.5) {
    warnings.push("Word/whitespace pattern doesn't resemble normal prose.");
  }
  if (boilerplateMarkerHits >= 2) {
    warnings.push("Extracted text appears to contain embedded PDF font/licensing metadata rather than document content.");
  }
  if (repeatedBlock.coverageRatio >= REPEATED_BLOCK_HARD_FAIL_COVERAGE || repeatedBlock.distinctContentLength < REPEATED_BLOCK_MIN_DISTINCT_CHARS) {
    warnings.push(
      "Extracted text is mostly a repeated block (e.g. a running page header/footer) with little or no distinct document content.",
    );
  } else if (repeatedBlock.coverageRatio > REPEATED_BLOCK_WARN_COVERAGE) {
    warnings.push("A sizeable portion of the extracted text is a repeated block. Verify the document body was fully captured.");
  }
  if (/(\S{1,20})(\s+\1){6,}/i.test(text)) {
    warnings.push("Contains an excessively repeated token, a common artifact of scanning the wrong PDF stream.");
  }
  const punctuationCount = (text.match(/[^\w\s]/gu) ?? []).length;
  if (punctuationCount / length > 0.35) {
    warnings.push("Unusually high punctuation density for prose text.");
  }
  if (length >= STRUCTURAL_CHECK_MIN_LENGTH && avgWordLength > MAX_PLAUSIBLE_AVG_WORD_LENGTH) {
    warnings.push(
      `Average "word" length (${avgWordLength.toFixed(1)} characters) is far outside normal prose. Text does not appear to be genuine word-broken content.`,
    );
  } else if (length >= STRUCTURAL_CHECK_MIN_LENGTH && sentenceBoundaryCount === 0 && whitespaceRatio > 0.05 && whitespaceRatio < 0.5) {
    // Softer signal, warning-only (not a hard fail): plenty of normal
    // word breaks, but not one ordinary sentence-ending boundary in
    // several hundred+ characters. Legitimate for some legislative
    // fragments (a long list of undivided defined terms, for example),
    // so this only nudges the score down rather than hard-failing.
    warnings.push("No ordinary sentence-ending punctuation found despite the text's length. Reading order may be unreliable.");
  }

  const hardFailReason = classifyHardFailReason(
    length,
    printableRatio,
    replacementRatio,
    controlRatio,
    boilerplateMarkerHits,
    avgWordLength,
    repeatedBlock,
  );

  // Soft score: start at 1.0, subtract a fixed penalty per triggered
  // warning. Only used to distinguish "extracted" from "low_quality" once
  // the hard-fail gate above has already been cleared.
  const score = Math.max(0, 1 - warnings.length * 0.15);

  return {
    score,
    passed: hardFailReason === undefined,
    hardFailReason,
    characterQuality: classifyCharacterQuality(printableRatio, controlRatio, replacementRatio),
    structuralQuality: classifyStructuralQuality(length, avgWordLength, sentenceBoundaryCount),
    warnings,
    metrics: {
      length,
      printableRatio,
      replacementRatio,
      controlRatio,
      alphabeticRatio,
      whitespaceRatio,
      boilerplateMarkerHits,
      avgWordLength,
      sentenceBoundaryCount,
      repeatedBlockCoverageRatio: repeatedBlock.coverageRatio,
      distinctContentLength: repeatedBlock.distinctContentLength,
    },
  };
}

/**
 * Content-quality status stored on `case_law`/`statutes` (see 0071/0072
 * migrations) and checked by the `publish_*_import` RPCs before allowing
 * publish. Derived once, client-side, from an `ExtractionEnvelope` so the
 * database never needs to know that jsonb shape -- it only ever sees this
 * plain enum string. `"unknown"` covers manual-paste text (never quality-
 * gated, see `buildManualPasteEnvelope`) so a curator's own typed text is
 * never blocked by an automated check.
 */
export type ContentQualityStatus = "good" | "fair" | "poor" | "failed" | "unknown";

export function deriveContentQualityStatus(envelope: {
  status: string;
  qualityScore: number | null;
  characterQuality: QualityBucket | null;
  structuralQuality: QualityBucket | null;
}): ContentQualityStatus {
  if (envelope.status === "failed") return "failed";
  if (envelope.qualityScore === null) return "unknown";
  if (envelope.characterQuality === "poor" || envelope.structuralQuality === "poor") return "poor";
  if (envelope.qualityScore >= CLEAN_SCORE_THRESHOLD) return "good";
  return "fair";
}

export { CLEAN_SCORE_THRESHOLD };
