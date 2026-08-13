/**
 * Deterministic OCR accuracy metrics used by regression tests.
 * Not shown in the curator UI — character/word error rates are lab
 * measurements, not a third "quality percentage" on the Review Queue.
 */

export const normalizeForCompare = (text: string): string => {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[—–]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

const levenshtein = (a: string, b: string): number => {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const rows = a.length + 1
  const cols = b.length + 1
  let prev = new Uint32Array(cols)
  let curr = new Uint32Array(cols)
  for (let j = 0; j < cols; j++) prev[j] = j
  for (let i = 1; i < rows; i++) {
    curr[0] = i
    const ca = a.charCodeAt(i - 1)
    for (let j = 1; j < cols; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1
      const ins = curr[j - 1] + 1
      const del = prev[j] + 1
      const sub = prev[j - 1] + cost
      curr[j] = ins < del ? (ins < sub ? ins : sub) : del < sub ? del : sub
    }
    const tmp = prev
    prev = curr
    curr = tmp
  }
  return prev[b.length]
}

/** Character Error Rate: Levenshtein(ocr, truth) / truth.length. 0 is perfect. */
export const characterErrorRate = (recognized: string, truth: string): number => {
  const a = normalizeForCompare(recognized)
  const b = normalizeForCompare(truth)
  if (!b.length) return a.length === 0 ? 0 : 1
  return levenshtein(a, b) / b.length
}

/** Word Error Rate over whitespace-tokenized, normalized words. */
export const wordErrorRate = (recognized: string, truth: string): number => {
  const a = normalizeForCompare(recognized).split(" ").filter(Boolean)
  const b = normalizeForCompare(truth).split(" ").filter(Boolean)
  if (!b.length) return a.length === 0 ? 0 : 1
  const n = a.length
  const m = b.length
  let prev = new Uint32Array(m + 1)
  let curr = new Uint32Array(m + 1)
  for (let j = 0; j <= m; j++) prev[j] = j
  for (let i = 1; i <= n; i++) {
    curr[0] = i
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const ins = curr[j - 1] + 1
      const del = prev[j] + 1
      const sub = prev[j - 1] + cost
      curr[j] = ins < del ? (ins < sub ? ins : sub) : del < sub ? del : sub
    }
    const tmp = prev
    prev = curr
    curr = tmp
  }
  return prev[m] / m
}

export const containsNormalized = (haystack: string, needle: string): boolean => {
  return normalizeForCompare(haystack).includes(normalizeForCompare(needle))
}
