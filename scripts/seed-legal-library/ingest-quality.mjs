/**
 * Pure, DB-free helpers factored out of ingest-harvest.mjs so they can be
 * unit-tested directly (scripts/tests/test-ingest-harvest-quality.mjs)
 * without touching Supabase. Two responsibilities:
 *
 *   1. buildEnvelope(rawText) — an honest ExtractionEnvelope built from the
 *      REAL assessExtractionQuality() gate (src/lib/extraction-quality.ts),
 *      replacing the old envelope() that hand-fabricated a fixed "perfect
 *      quality" result regardless of content (the root cause of 18
 *      boilerplate-only and 74 OCR-garbled Acts publishing silently).
 *
 *   2. decideLegislationTitle(...) — never silently overwrites a good
 *      harvested title with a guess; only prefers the extracted title when
 *      the harvested one is missing, suspiciously short, or identical to
 *      the code (the exact "title=code=Marriage" defect the audit found).
 */
import { assessExtractionQuality, CLEAN_SCORE_THRESHOLD, deriveContentQualityStatus } from "@/lib/extraction-quality";

export { deriveContentQualityStatus };

const SEED_DISCLAIMER = "Seeded from an official public source. Curator must still vet before publish.";
const CATALOG_ONLY_WARNING = "Catalog entry only — attach or paste the official text in Review Queue.";

/**
 * Legislation-specific, deliberately NOT part of the shared
 * assessExtractionQuality() gate (src/lib/extraction-quality.ts) — that
 * module must stay document-agnostic (see its own doc comment), and this
 * check is intentionally keyed to gazette-page wording. It exists because
 * the repeated-block detector in that shared module structurally cannot
 * catch a SHORT document (a 1-page cover sheet only, no body ever
 * captured) — there is nothing to "repeat" in a single page, so
 * coverageRatio stays near zero even though there is effectively no real
 * content. Found via a bulk seed audit: several 1-page Acts (e.g. "GUYANA
 * ACT No. 5 of 2023 COURT OF APPEAL (AMENDMENT) ACT 2023" and nothing
 * else) scored "fair" from the generic gate despite having no enacting
 * text at all.
 */
const GAZETTE_LINE_RE = /official gazette|legal supplement|laws\s+of\s+guyana|^\s*a\.d\.\s*\d{4}|^\d+\s+the\s+official|no\.\s*\d+\]/i;
const MIN_DISTINCT_LEGISLATION_CONTENT = 150;

/** Character length of `text` after stripping gazette masthead/page-
 * furniture lines — an approximation of how much real content remains. */
export function estimateDistinctLegislationContent(text) {
  const lines = String(text ?? "").split("\n");
  const residue = lines
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !GAZETTE_LINE_RE.test(l));
  return residue.join(" ").length;
}

const HARD_FAIL_MESSAGE = {
  too_short: "Automated quality gate: extracted text is too short to be a real document.",
  repeated_running_header:
    "Automated quality gate: extracted text is mostly a repeated page header/footer block — the real document body was not captured.",
  printable_ratio: "Automated quality gate: too many non-printable/unexpected characters.",
  replacement_chars: "Automated quality gate: too many unrecognized-character (�) OCR artifacts.",
  boilerplate: "Automated quality gate: text looks like embedded PDF font/licensing metadata, not document content.",
  control_chars: "Automated quality gate: too many control characters for prose text.",
  structural_incoherence: "Automated quality gate: text does not resemble genuine word-broken prose.",
};

/**
 * Builds an honest ExtractionEnvelope-shaped object from raw harvested
 * text, using the real quality gate. Empty text keeps the same "pending"/
 * "none" shape the old fabricated envelope used (nothing to assess).
 */
export function buildEnvelope(rawText, method = "manual_paste") {
  const trimmed = String(rawText ?? "").trim();
  if (!trimmed) {
    return {
      status: "pending",
      method: "none",
      text: "",
      charCount: 0,
      qualityScore: null,
      characterQuality: null,
      structuralQuality: null,
      warnings: [CATALOG_ONLY_WARNING],
      ocrUsed: false,
      requiresReview: true,
      pages: [],
      pageCount: 0,
      unreadableReason: null,
    };
  }

  const assessment = assessExtractionQuality(trimmed);
  const status = !assessment.passed ? "failed" : assessment.score >= CLEAN_SCORE_THRESHOLD ? "extracted" : "low_quality";
  const warnings = [SEED_DISCLAIMER, ...assessment.warnings];
  if (assessment.hardFailReason) {
    warnings.push(HARD_FAIL_MESSAGE[assessment.hardFailReason] ?? `Automated quality gate: ${assessment.hardFailReason}.`);
  }

  return {
    status,
    method,
    text: status === "failed" ? "" : trimmed,
    charCount: status === "failed" ? 0 : trimmed.length,
    qualityScore: assessment.score,
    characterQuality: assessment.characterQuality,
    structuralQuality: assessment.structuralQuality,
    warnings,
    ocrUsed: false,
    requiresReview: true,
    pages: [],
    pageCount: 0,
    unreadableReason: null,
    hardFailReason: assessment.hardFailReason ?? null,
  };
}

/** A real Act/Ordinance/Regulations title, in practice, essentially
 * always contains its instrument type and/or an enactment year — "Marriage
 * (Amendment) Act 1985", "Cattle Stealing Prevention (Amendment) Act 1998".
 * A bare fragment like "Marriage" has neither. */
const LOOKS_LIKE_LEGISLATION_TITLE_RE = /\b(?:act|ordinance|regulations?|chapter|cap\.?)\b|\b(?:19|20)\d{2}\b/i;

/**
 * Applies the Legislation-specific thin-content override on top of an
 * already-built envelope: if the generic gate passed the text but almost
 * none of it survives gazette-line stripping, force status/quality to
 * "failed" anyway. Never makes a passing verdict worse in any OTHER way,
 * and never touches an envelope that already failed for its own reason.
 */
export function applyLegislationContentCheck(envelope) {
  if (envelope.status === "failed" || envelope.status === "pending") return envelope;
  const distinct = estimateDistinctLegislationContent(envelope.text);
  if (distinct >= MIN_DISTINCT_LEGISLATION_CONTENT) return envelope;
  return {
    ...envelope,
    status: "failed",
    text: "",
    charCount: 0,
    hardFailReason: "repeated_running_header",
    warnings: [
      ...envelope.warnings,
      `Automated quality gate: only ${distinct} character(s) of non-masthead content remain after removing gazette page furniture — this looks like a cover page only, not the Act's operative text.`,
    ],
  };
}

/**
 * True when a harvested title is suspect enough that an extracted
 * proposal should be preferred over it. Two independent signals, since
 * comparing against `harvestedCode` alone is unreliable — many harvested
 * items legitimately have no `code` at all, so a naive title===code check
 * (against a value that itself falls back to the title when code is
 * absent) would be trivially true for every single one of them:
 *   1. Too short to plausibly be a real title (<4 chars).
 *   2. Doesn't look like a legislation title at all — no instrument-type
 *      word (Act/Ordinance/Regulations/Chapter) and no year anywhere in
 *      it. This is the actual "Marriage" defect signature: not that it
 *      duplicated some other field, but that standing alone it reads as a
 *      bare noun fragment, not a title.
 * `harvestedCode` is still checked when it is a real, independently-
 * present (non-empty, non-null) value — a genuine title===code duplicate
 * is also suspect, it just can't be the ONLY signal.
 */
export function isHarvestedTitleSuspect(harvestedTitle, harvestedCode) {
  const title = String(harvestedTitle ?? "").trim();
  if (title.length < 4) return true;
  if (!LOOKS_LIKE_LEGISLATION_TITLE_RE.test(title)) return true;
  const code = harvestedCode == null ? "" : String(harvestedCode).trim();
  if (code && title.toLowerCase() === code.toLowerCase()) return true;
  return false;
}

/**
 * Decides the final title: keeps a good harvested title as authoritative
 * (never silently overwritten), otherwise prefers the extracted proposal
 * when it has any confidence. Returns { title, source }, source being
 * "harvested" | "extracted" | "none" — used to log/flag which path won.
 */
export function decideLegislationTitle({ harvestedTitle, harvestedCode, extracted }) {
  if (!isHarvestedTitleSuspect(harvestedTitle, harvestedCode)) {
    return { title: String(harvestedTitle).trim(), source: "harvested" };
  }
  if (extracted?.fields?.title && extracted.titleConfidence !== "none") {
    return { title: extracted.fields.title, source: "extracted" };
  }
  const fallback = String(harvestedTitle ?? "").trim();
  return { title: fallback || null, source: fallback ? "harvested" : "none" };
}
