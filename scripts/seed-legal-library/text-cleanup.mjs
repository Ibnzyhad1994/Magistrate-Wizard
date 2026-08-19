/**
 * Last-mile cleanup for short labels (title/code/short_title/citation/
 * case_name) right before insert — decodes HTML entities the harvest
 * scripts' own ad hoc stripping evidently missed in some fields, then
 * applies the same narrow, single-token-safe OCR fixes used elsewhere
 * (fixCommonOcrTokenSwaps from @/lib/ocr/postprocess), then collapses
 * whitespace. Deliberately NOT the full postprocessOcrText — that
 * function's newline-collapsing and "v"-spacing regexes are tuned for
 * multi-line judgment prose and could misfire on a one-line title.
 */
import { fixCommonOcrTokenSwaps } from "@/lib/ocr/postprocess";

const ENTITY_MAP = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  "#39": "'",
};

function decodeHtmlEntities(raw) {
  return raw.replace(/&(#\d+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity in ENTITY_MAP) return ENTITY_MAP[entity];
    if (entity.startsWith("#")) {
      const codePoint = Number(entity.slice(1));
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    return match;
  });
}

export function cleanLegislationLabel(raw) {
  if (!raw) return raw;
  const decoded = decodeHtmlEntities(String(raw));
  const swapped = fixCommonOcrTokenSwaps(decoded);
  return swapped.replace(/\s+/g, " ").trim();
}
