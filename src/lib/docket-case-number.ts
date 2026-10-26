/**
 * Case numbers are unique per Magisterial District ignoring letter case and
 * the surrounding whitespace (docket_matters_district_case_number_unique,
 * 0166), so "B-12/2026" and " b-12/2026 " are the same file. The create
 * dialog's live duplicate check uses these to agree with that index.
 */

/** The form a case number is compared in: trimmed and upper-cased. */
export const caseNumberKey = (caseNumber: string) => caseNumber.trim().toUpperCase();

/** True when two case numbers name the same file under the district rule. */
export const isSameCaseNumber = (a: string, b: string) => caseNumberKey(a) === caseNumberKey(b);

/**
 * Escapes `\`, `%` and `_` so the text matches literally in a LIKE/ILIKE
 * pattern. The database's escape_like_pattern() (0166) is the same rule.
 */
export const escapeLikePattern = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`);
