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

export type QualityHardFailReason = "too_short" | "printable_ratio" | "replacement_chars" | "boilerplate" | "control_chars";

export interface QualityAssessment {
  /** 0-1. Not shown to the curator as a precise number — used only to choose between "extracted" and "low_quality". */
  score: number;
  passed: boolean;
  /** Set only when `passed` is false — used by the caller to decide between a "failed" (wrong content) vs. "requires_ocr" (nothing usable) status. */
  hardFailReason?: QualityHardFailReason;
  warnings: string[];
  metrics: {
    length: number;
    printableRatio: number;
    replacementRatio: number;
    controlRatio: number;
    alphabeticRatio: number;
    whitespaceRatio: number;
    boilerplateMarkerHits: number;
  };
}

const MIN_LENGTH = 200;
const MIN_PRINTABLE_RATIO = 0.85;
const MAX_REPLACEMENT_RATIO = 0.01;
const MAX_CONTROL_RATIO = 0.02;
const MIN_ALPHABETIC_RATIO = 0.35;
const CLEAN_SCORE_THRESHOLD = 0.75;

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

function classifyHardFailReason(
  length: number,
  printableRatio: number,
  replacementRatio: number,
  controlRatio: number,
  boilerplateHits: number,
): QualityHardFailReason | undefined {
  if (length < MIN_LENGTH) return "too_short";
  if (boilerplateHits >= 2) return "boilerplate";
  if (replacementRatio > MAX_REPLACEMENT_RATIO) return "replacement_chars";
  if (controlRatio > MAX_CONTROL_RATIO) return "control_chars";
  if (printableRatio < MIN_PRINTABLE_RATIO) return "printable_ratio";
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
      metrics: {
        length,
        printableRatio: 0,
        replacementRatio: 0,
        controlRatio: 0,
        alphabeticRatio: 0,
        whitespaceRatio: 0,
        boilerplateMarkerHits: 0,
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

  if (printableRatio < MIN_PRINTABLE_RATIO) {
    warnings.push(
      `Only ${(printableRatio * 100).toFixed(0)}% of characters are printable/expected text — likely a garbled or binary-derived extraction.`,
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
  if (/(\S{1,20})(\s+\1){6,}/i.test(text)) {
    warnings.push("Contains an excessively repeated token — a common artifact of scanning the wrong PDF stream.");
  }
  const punctuationCount = (text.match(/[^\w\s]/gu) ?? []).length;
  if (punctuationCount / length > 0.35) {
    warnings.push("Unusually high punctuation density for prose text.");
  }

  const hardFailReason = classifyHardFailReason(length, printableRatio, replacementRatio, controlRatio, boilerplateMarkerHits);

  // Soft score: start at 1.0, subtract a fixed penalty per triggered
  // warning. Only used to distinguish "extracted" from "low_quality" once
  // the hard-fail gate above has already been cleared.
  const score = Math.max(0, 1 - warnings.length * 0.15);

  return {
    score,
    passed: hardFailReason === undefined,
    hardFailReason,
    warnings,
    metrics: { length, printableRatio, replacementRatio, controlRatio, alphabeticRatio, whitespaceRatio, boilerplateMarkerHits },
  };
}

export { CLEAN_SCORE_THRESHOLD };
