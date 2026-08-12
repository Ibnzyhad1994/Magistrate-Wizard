/**
 * Shared, deterministic publication-gate validation for Case Law and
 * Legislation (BenchBook Case Law ingestion golden-path repair pass).
 *
 * Used in TWO places for the SAME rule set, never one without the other:
 *   1. Frontend — disables/explains the Publish button (ReviewQueueTab
 *      cards in legal-library-admin-page.tsx) so the curator sees why a
 *      record can't be published, before ever attempting the call.
 *   2. Database — the `publish_case_law_import`/`publish_legislation_import`
 *      RPCs (migration 0061) re-check the identical placeholder list in
 *      SQL, so a record can never be published through any path (this
 *      admin UI today, a future bulk tool, a direct RPC call) while still
 *      holding placeholder metadata. Keep the two lists in sync if this
 *      one changes — see 0061's `v_bad` array.
 *
 * A record with placeholder-only metadata (case_name left as the
 * "Untitled (pending review)" system default, an unresolved raw value
 * like "COA" never mapped to a canonical Court, etc.) must never reach
 * the published Case Law/Legislation library — that was the exact defect
 * the live browser test surfaced.
 */

const PLACEHOLDER_VALUES = new Set([
  "",
  "untitled",
  "untitled (pending review)",
  "unknown",
  "tbd",
  "n/a",
  "na",
  "none",
  "pending",
  "pending review",
  "coa",
  "court",
  "jurisdiction",
]);

export function isPlaceholderValue(value: string | null | undefined): boolean {
  return PLACEHOLDER_VALUES.has((value ?? "").trim().toLowerCase());
}

export interface CaseLawPublishFields {
  case_name: string;
  citation: string;
  /** Legacy free-text columns — auto-populated from the canonical selection, not typed separately by the curator (§2/§3). Checked here too as a defense-in-depth backstop, not the primary gate. */
  court: string;
  jurisdiction: string;
  court_id: string | null;
  jurisdiction_id: string | null;
}

/** Returns a human-readable list of blocking reasons; empty array means publishable. */
export function validateCaseLawForPublish(fields: CaseLawPublishFields): string[] {
  const errors: string[] = [];
  if (isPlaceholderValue(fields.case_name)) errors.push("Case name requires review.");
  if (isPlaceholderValue(fields.citation)) errors.push("Citation is missing.");
  if (!fields.jurisdiction_id || isPlaceholderValue(fields.jurisdiction)) {
    errors.push("Jurisdiction is missing.");
  }
  if (!fields.court_id || isPlaceholderValue(fields.court)) {
    errors.push("Court is missing.");
  }
  return errors;
}

export interface LegislationPublishFields {
  code: string;
  title: string;
  jurisdiction: string;
  jurisdiction_id: string | null;
}

export function validateLegislationForPublish(fields: LegislationPublishFields): string[] {
  const errors: string[] = [];
  if (isPlaceholderValue(fields.title)) errors.push("Title requires review.");
  if (isPlaceholderValue(fields.code)) errors.push("Code is missing.");
  if (!fields.jurisdiction_id || isPlaceholderValue(fields.jurisdiction)) {
    errors.push("Jurisdiction is missing.");
  }
  return errors;
}
