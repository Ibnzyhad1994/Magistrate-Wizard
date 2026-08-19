/**
 * Deterministic (non-AI) matching of extracted/pasted document text against
 * the canonical `legal_authority_courts` reference catalogue — the "propose
 * Court where confidently identifiable" half of §8/§11.
 *
 * REAL-PDF REGRESSION (Ramsingh, "REAL CASE LAW PDF METADATA EXTRACTION
 * REPAIR PASS"): a naive "longest canonical name wins, whole-document
 * substring search" approach picked "Judicial Committee of the Privy
 * Council" over "Court of Appeal of Guyana" even though the extracted
 * text's HEADER read "COURT OF APPEAL OF GUYANA" verbatim — because (a)
 * JCPC's canonical name is longer so it was checked first regardless of
 * where any match actually occurred, and (b) the Ramsingh judgment BODY
 * (discussing further appeal rights, as many Caribbean appellate
 * judgments do) mentions "Privy Council" — a short, generic alias that
 * matched anywhere in the whole document with no positional weighting at
 * all. This module now scores every candidate match instead of taking
 * the first hit from an arbitrary sort order:
 *
 *   - A match in the HEADER region (the first ~3000 extracted characters
 *     — roughly the title/citation/court-heading block, before the
 *     judgment body proper) scores far higher than a match found only in
 *     the body. A court mentioned in passing later in a judgment (another
 *     authority cited, an appeal route discussed) is NOT evidence of who
 *     decided THIS case.
 *   - An exact match on the court's own `canonical_name` scores higher
 *     than a match on its curated `short_name` (e.g. "CCJ", "Privy
 *     Council"), which in turn scores higher than a match on a free-form
 *     `aliases` entry.
 *   - Short alias matches (a common source of false positives — "Court
 *     of Appeal" alone could match almost any jurisdiction's judgment)
 *     are penalized relative to longer, more specific names. `short_name`
 *     is exempt from this penalty — it's curated, structured data, not a
 *     loosely-added alias.
 *   - A final confidence floor: if nothing scores high enough, the caller
 *     gets `null` (Needs Review) rather than a low-confidence guess. It
 *     is better to leave Court unset than to confidently assign the
 *     wrong one.
 *
 * This is a deterministic point-scoring system, not a machine-learning
 * confidence model — intentionally, per the explicit instruction not to
 * over-engineer this.
 */

export interface CourtLike {
  id: string;
  canonical_name: string;
  short_name: string | null;
  aliases: string[];
  jurisdiction_id: string | null;
}

export type CourtMatchConfidence = "high" | "medium" | "low";

export interface CourtMatch {
  court: CourtLike;
  confidence: CourtMatchConfidence;
  /** The exact name/alias text that matched, for diagnostics/UI messaging — never shown as if it were the canonical name itself. */
  matchedText: string;
}

/** Extracted text before this offset is treated as the document's header/title/citation/court-heading block; matches after it are treated as body references only. */
const HEADER_WINDOW_CHARS = 3000;
/** Names shorter than this are more prone to false-positive collisions ("CCJ" inside an unrelated word, "Full Court" as a generic term) and are scored down accordingly — except `short_name`, which is curated structured data, not a loosely-added alias. */
const SHORT_NAME_CHARS = 14;
/** Below this score, the match is discarded entirely rather than returned as a low-confidence guess. */
const MIN_CONFIDENCE_SCORE = 35;

interface Candidate {
  court: CourtLike;
  name: string;
  index: number;
  source: "canonical" | "short_name" | "alias";
}

function scoreCandidate(c: Candidate): number {
  let score = c.name.length;
  if (c.source === "canonical") score += 20;
  else if (c.source === "short_name") score += 10;
  else if (c.name.length < SHORT_NAME_CHARS) score -= 15; // free-form alias, short and generic-prone

  if (c.index < HEADER_WINDOW_CHARS) score += 60;
  else score -= 10; // body-only reference — mentioned, not necessarily deciding

  return score;
}

/**
 * Returns the highest-confidence court match with full scoring detail
 * (confidence tier + matched text), or null if nothing clears the
 * confidence floor. Prefer this over `matchCanonicalCourt` when the
 * caller wants to show the curator WHY a Court was proposed / whether to
 * treat it as auto-selected vs. "please confirm."
 */
export function matchCanonicalCourtScored(text: string, courts: CourtLike[]): CourtMatch | null {
  const hay = text || "";
  if (!hay.trim()) return null;
  const hayUpper = hay.toUpperCase();

  const candidates: Candidate[] = [];
  for (const court of courts) {
    const names: { name: string; source: Candidate["source"] }[] = [
      { name: court.canonical_name, source: "canonical" },
      ...(court.short_name ? [{ name: court.short_name, source: "short_name" as const }] : []),
      ...(court.aliases ?? []).map((a) => ({ name: a, source: "alias" as const })),
    ];
    for (const { name, source } of names) {
      if (!name || name.trim().length <= 2) continue;
      const idx = hayUpper.indexOf(name.toUpperCase());
      if (idx === -1) continue;
      candidates.push({ court, name, index: idx, source });
    }
  }
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => scoreCandidate(b) - scoreCandidate(a) || a.index - b.index);
  const visible = candidates.filter((c) => {
    const name = c.name.toUpperCase();
    return !candidates.some((other) => {
      if (other === c) return false;
      const otherName = other.name.toUpperCase();
      return otherName.length > name.length && otherName.includes(name);
    });
  });
  const best = (visible.length > 0 ? visible : candidates)[0];
  const bestScore = scoreCandidate(best);
  if (bestScore < MIN_CONFIDENCE_SCORE) return null;

  return {
    court: best.court,
    confidence: bestScore >= 80 ? "high" : bestScore >= 55 ? "medium" : "low",
    matchedText: best.name,
  };
}

/** Convenience wrapper returning just the matched court (or null), for call sites that don't need confidence detail. */
export function matchCanonicalCourt(text: string, courts: CourtLike[]): CourtLike | null {
  return matchCanonicalCourtScored(text, courts)?.court ?? null;
}
