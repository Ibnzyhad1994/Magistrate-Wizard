/**
 * Legal-aware Proper Case for `case_law.case_name` only — never apply this
 * to citations (`citation`, `neutral_citation`, `reported_citation`).
 *
 * Idempotent: a name that is already correctly cased is returned unchanged.
 * The matching SQL function `format_case_law_title` (0119) must stay in
 * lockstep with this helper — the BEFORE INSERT/UPDATE trigger is the
 * actual write-path enforcement; this copy keeps forms and tests aligned.
 */

const PLACEHOLDER = "Untitled (pending review)"

const CONNECTORS = new Set(["v", "vs", "v.", "vs."])

const SMALL_WORDS = new Set(["of", "the", "and", "in", "for", "ex", "p", "parte"])

const ACRONYMS = new Set(["r", "dpp", "ag", "a-g", "ccj", "cj"])

const formatAtom = (raw: string, forceCap: boolean): string => {
  if (!raw) return raw
  const lower = raw.toLowerCase()

  if (CONNECTORS.has(lower)) return lower

  if (!forceCap && SMALL_WORDS.has(lower)) return lower

  if (ACRONYMS.has(lower)) {
    if (lower === "a-g") return "A-G"
    if (lower === "r") return "R"
    return raw.toUpperCase()
  }

  if (/^mc[a-z]{2,}$/i.test(raw)) {
    return "Mc" + raw.slice(2, 3).toUpperCase() + raw.slice(3).toLowerCase()
  }

  if (/^o'[a-z]+$/i.test(raw)) {
    return "O'" + raw.slice(2, 3).toUpperCase() + raw.slice(3).toLowerCase()
  }

  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase()
}

const formatHyphenated = (word: string, forceCap: boolean): string => {
  return word
    .split("-")
    .map((part, i) => formatAtom(part, i === 0 ? forceCap : true))
    .join("-")
}

export function formatCaseLawTitle(input: string | null | undefined): string {
  if (input == null) return ""
  const trimmed = input.trim().replace(/\s+/g, " ")
  if (!trimmed) return ""
  if (trimmed.toLowerCase() === PLACEHOLDER.toLowerCase()) return PLACEHOLDER

  const words = trimmed.split(" ")
  let prevConnector = false
  return words
    .map((word, i) => {
      const forceCap = i === 0 || prevConnector
      const formatted = formatHyphenated(word, forceCap)
      prevConnector = CONNECTORS.has(word.toLowerCase())
      return formatted
    })
    .join(" ")
}
