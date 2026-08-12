/**
 * Deterministic (non-AI) matching of extracted/pasted document text against
 * the canonical `legal_authority_courts` reference catalogue — the "propose
 * Court where confidently identifiable" half of §8/§11. A judgment's
 * heading text commonly contains the deciding court's name near-verbatim
 * (e.g. "COURT OF APPEAL OF GUYANA"), so a case-insensitive substring match
 * against each court's canonical name/short name/aliases is a reliable,
 * explainable proposal — never a guess dressed up as a fact. The caller
 * always leaves the result editable; this only pre-fills the canonical
 * Court/Jurisdiction selects the curator would otherwise have to search
 * for manually.
 */

export interface CourtLike {
  id: string;
  canonical_name: string;
  short_name: string | null;
  aliases: string[];
  jurisdiction_id: string | null;
}

/**
 * Returns the first court whose canonical name/short name/alias appears in
 * `text`, preferring longer (more specific) names first so a short alias
 * (e.g. "CA") can't shadow a more specific court's full name match. Returns
 * null rather than guessing when nothing matches — the curator selects
 * manually in that case, per §10's "leave it for review rather than
 * guessing."
 */
export function matchCanonicalCourt(text: string, courts: CourtLike[]): CourtLike | null {
  const hay = (text || "").toUpperCase();
  if (!hay.trim()) return null;

  const candidates = [...courts].sort(
    (a, b) => b.canonical_name.length - a.canonical_name.length,
  );

  for (const court of candidates) {
    const names = [court.canonical_name, court.short_name, ...(court.aliases ?? [])].filter(
      (n): n is string => !!n && n.trim().length > 2,
    );
    for (const name of names) {
      if (hay.includes(name.toUpperCase())) return court;
    }
  }
  return null;
}
