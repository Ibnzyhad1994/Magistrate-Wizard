/**
 * Language/script honesty for extracted document text.
 *
 * Caribbean legal prose is Latin script, including accented names
 * (José, François, naïve, café). Han/Cyrillic/Arabic dumps from a
 * wrong CMap, and latin1-as-UTF-8 mojibake (JosÃ©), are decoding
 * failures — they must not be stored as a successful extract.
 */

export type ExtractionLanguageReason = "wrong_script" | "mojibake"

export interface ExtractionLanguageAssessment {
  ok: boolean
  reason: ExtractionLanguageReason | null
  letters: number
  latin: number
  han: number
  cyrillic: number
  arabic: number
  otherLetters: number
  nonLatinRatio: number
  mojibakeHits: number
}

const MOJIBAKE_RE = /Ã.|Â.|â€[™œ“”]|þÿ/g
const MIN_FOREIGN_LETTERS = 20
const MAX_NON_LATIN_RATIO = 0.08
const MIN_MOJIBAKE_HITS = 3

export const LANGUAGE_HONESTY_MESSAGE: Record<ExtractionLanguageReason, string> = {
  wrong_script:
    "Extracted characters are not Latin legal prose, likely a font or CMap decoding error, not a translation.",
  mojibake:
    "Extracted text looks like a character-encoding failure (mojibake), not the original language of the document.",
}

export const assessExtractionLanguage = (text: string): ExtractionLanguageAssessment => {
  const sample = String(text ?? "")
  let letters = 0
  let latin = 0
  let han = 0
  let cyrillic = 0
  let arabic = 0
  let otherLetters = 0
  for (const ch of sample) {
    if (!/\p{L}/u.test(ch)) continue
    letters += 1
    if (/\p{Script=Latin}/u.test(ch)) latin += 1
    else if (/\p{Script=Han}/u.test(ch)) han += 1
    else if (/\p{Script=Cyrillic}/u.test(ch)) cyrillic += 1
    else if (/\p{Script=Arabic}/u.test(ch)) arabic += 1
    else otherLetters += 1
  }
  const nonLatin = letters - latin
  const nonLatinRatio = letters === 0 ? 0 : nonLatin / letters
  const mojibakeHits = (sample.match(MOJIBAKE_RE) ?? []).length
  const wrongScript =
    han >= MIN_FOREIGN_LETTERS ||
    cyrillic >= MIN_FOREIGN_LETTERS ||
    arabic >= MIN_FOREIGN_LETTERS ||
    nonLatinRatio >= MAX_NON_LATIN_RATIO
  const mojibake = mojibakeHits >= MIN_MOJIBAKE_HITS
  const reason: ExtractionLanguageReason | null = wrongScript ? "wrong_script" : mojibake ? "mojibake" : null
  return {
    ok: reason === null,
    reason,
    letters,
    latin,
    han,
    cyrillic,
    arabic,
    otherLetters,
    nonLatinRatio: Number(nonLatinRatio.toFixed(4)),
    mojibakeHits,
  }
}
