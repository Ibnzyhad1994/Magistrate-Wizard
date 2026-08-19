// Regression tests for scripts/seed-legal-library/ingest-quality.mjs —
// the pure, DB-free functions factored out of ingest-harvest.mjs so the
// bulk seed-legislation quality gate can be tested directly, without a
// live Supabase connection. See INGESTION_CHECKLIST.md.
//
// Run with:
//   node --experimental-strip-types --import ./scripts/test-support/register.mjs scripts/tests/test-ingest-harvest-quality.mjs

import {
  buildEnvelope,
  deriveContentQualityStatus,
  decideLegislationTitle,
  isHarvestedTitleSuspect,
  applyLegislationContentCheck,
} from "../seed-legal-library/ingest-quality.mjs";
import { extractLegislationMetadataWithConfidence } from "@/lib/legal-extraction";

let failures = 0;
function check(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} - ${label}`);
  if (!pass) {
    console.log("  expected:", expected);
    console.log("  actual:  ", actual);
    failures += 1;
  }
}

// buildEnvelope: empty text keeps the old "pending"/"none" shape.
{
  const env = buildEnvelope("");
  check("empty text envelope status is pending", env.status, "pending");
  check("empty text envelope method is none", env.method, "none");
}

// buildEnvelope: the real, root-cause fixture — 100% repeated gazette
// header/footer, the exact shape found in 18/184 seeded Acts. The OLD
// envelope() fabricated qualityScore:1/characterQuality:"high" for any
// non-empty text; this MUST now report status "failed" with a specific
// hard-fail reason.
{
  const pageHeader = (page) =>
    `THE OFFICIAL GAZETTE ${page} LEGAL SUPPLEMENT A LAWS OF GUYANA A.D. 2025 No. 13 THE OFFICIAL GAZETTE`;
  const boilerplateOnly = Array.from({ length: 20 }, (_, i) => pageHeader(i + 1)).join(" ");
  const env = buildEnvelope(boilerplateOnly);
  check("boilerplate-only text envelope status is failed", env.status, "failed");
  check("boilerplate-only text hardFailReason is repeated_running_header", env.hardFailReason, "repeated_running_header");
  check("boilerplate-only text characterQuality is a real bucket, never 'high'", env.characterQuality !== "high", true);
  check("boilerplate-only text structuralQuality is a real bucket, never 'medium'", env.structuralQuality !== "medium", true);
}

// buildEnvelope: genuine, substantial legislative text passes cleanly.
{
  const realText =
    "1. This Act may be cited as the Marriage (Amendment) Act 1985 and shall come into operation " +
    "on a date to be fixed by the Minister by order published in the Gazette.\n\n" +
    "2. Section 5 of the Principal Act is amended by the deletion of subsection (2) and the " +
    "substitution therefor of the following new subsection: '(2) The Registrar shall record every " +
    "marriage solemnized under this Act in the register kept for that purpose at the office of the " +
    "Registrar General.' 3. This Act shall be read and construed as one with the Principal Act.";
  const env = buildEnvelope(realText);
  check("genuine legislative text envelope status is extracted", env.status, "extracted");
  check("genuine legislative text has no hardFailReason", env.hardFailReason, null);
}

// deriveContentQualityStatus mapping.
{
  check("failed status maps to 'failed'", deriveContentQualityStatus({ status: "failed", qualityScore: 0, characterQuality: "poor", structuralQuality: "poor" }), "failed");
  check("pending/no-score maps to 'unknown'", deriveContentQualityStatus({ status: "pending", qualityScore: null, characterQuality: null, structuralQuality: null }), "unknown");
  check("poor characterQuality maps to 'poor' even if status passed", deriveContentQualityStatus({ status: "low_quality", qualityScore: 0.5, characterQuality: "poor", structuralQuality: "fair" }), "poor");
  check("high score maps to 'good'", deriveContentQualityStatus({ status: "extracted", qualityScore: 0.9, characterQuality: "good", structuralQuality: "good" }), "good");
  check("mid score maps to 'fair'", deriveContentQualityStatus({ status: "low_quality", qualityScore: 0.6, characterQuality: "fair", structuralQuality: "fair" }), "fair");
}

// isHarvestedTitleSuspect / decideLegislationTitle — the "Marriage"/
// "Marriage" defect class, and the "never silently overwrite a good
// harvested title" guarantee.
{
  check("title identical to code is suspect", isHarvestedTitleSuspect("Marriage", "Marriage"), true);
  check("very short title is suspect", isHarvestedTitleSuspect("Ma", "13 of 1985"), true);
  check("a real, distinct title is not suspect", isHarvestedTitleSuspect("Marriage (Amendment) Act 1985", "13 of 1985"), false);

  const realText =
    "GUYANA\nACT No. 13 of 1985\nMARRIAGE (AMENDMENT) ACT 1985\n\n" +
    "1. This Act may be cited as the Marriage (Amendment) Act 1985.";
  const extracted = extractLegislationMetadataWithConfidence(realText);

  const suspectDecision = decideLegislationTitle({
    harvestedTitle: "Marriage",
    harvestedCode: "Marriage",
    extracted,
  });
  check("suspect title=code is replaced by the extracted title", suspectDecision.source, "extracted");
  check("suspect title=code recovers the real Act title", suspectDecision.title, "Marriage (Amendment) Act 1985");

  const goodDecision = decideLegislationTitle({
    harvestedTitle: "Criminal Law Miscellaneous Act- 10 of 2025",
    harvestedCode: "10 of 2025",
    extracted: null,
  });
  check("a good harvested title is kept, never overwritten", goodDecision.source, "harvested");
  check("a good harvested title is preserved verbatim", goodDecision.title, "Criminal Law Miscellaneous Act- 10 of 2025");
}

// applyLegislationContentCheck — the "1-page cover sheet only" gap: real
// fixture from the bulk audit, a short Act whose extracted text is just
// the masthead/title page with no operative section text. Too short/too
// few repeats for the shared repeated-block detector to fire on its own
// (that's the whole reason this override exists), so the generic gate
// alone reports "fair" for it — the override must still catch it.
{
  // Real fixture (the actual harvested full_text for "6 of 2023" — Motor
  // Vehicles and Road Traffic (Amendment) Act 2023 — one of the false
  // negatives found in the live re-audit before this override existed).
  const coverPageOnly =
    "THE OFFICIAL GAZETTE   22ND MAY, 2023 \nLEGAL SUPPLEMENT —    A \n \n \n \nGUYANA \n \nACT No. 6 of 2023 \n \n" +
    "MOTOR VEHICLES AND ROAD TRAFFIC (AMENDMENT) ACT 2023 \n \n         \n     \n      \n \n \n \n \n \n \n \n \n \n \n \n        \n\n  \n" +
    "26                      THE OFFICIAL GAZETTE [LEGAL SUPPLEMENT]      —      A    22ND  MAY, 2023 \n \n \n \n" +
    "No. 6]                                                         LAWS  OF  GUYANA                                                  [A.D. 2023";
  const baseEnv = buildEnvelope(coverPageOnly, "manual_paste");
  // Long enough to clear the generic too_short gate, but the shared
  // repeated-block detector still can't fire (nothing repeats in a single
  // short cover page) — this is exactly the gap the override exists for.
  check(
    "cover-page-only text is NOT hard-failed by the generic gate alone",
    baseEnv.status === "extracted" || baseEnv.status === "low_quality",
    true,
  );
  const overridden = applyLegislationContentCheck(baseEnv);
  check("legislation content override catches the cover-page-only case", overridden.status, "failed");
  check("override maps to content_quality_status 'failed'", deriveContentQualityStatus(overridden), "failed");
}

// The override must never touch an already-good, substantial document.
{
  const realText =
    "1. This Act may be cited as the Marriage (Amendment) Act 1985 and shall come into operation " +
    "on a date to be fixed by the Minister by order published in the Gazette.\n\n" +
    "2. Section 5 of the Principal Act is amended by the deletion of subsection (2) and the " +
    "substitution therefor of the following new subsection: '(2) The Registrar shall record every " +
    "marriage solemnized under this Act in the register kept for that purpose at the office of the " +
    "Registrar General.' 3. This Act shall be read and construed as one with the Principal Act.";
  const baseEnv = buildEnvelope(realText, "manual_paste");
  const overridden = applyLegislationContentCheck(baseEnv);
  check("substantial legislative text is unaffected by the override", overridden.status, "extracted");
}

// The override must never touch an envelope that already failed for its
// own reason (e.g. the shared repeated-block detector already caught it)
// — no double-processing, no losing the original hardFailReason.
{
  const pageHeader = (page) => `THE OFFICIAL GAZETTE ${page} LEGAL SUPPLEMENT A LAWS OF GUYANA A.D. 2025 No. 13 THE OFFICIAL GAZETTE`;
  const boilerplateOnly = Array.from({ length: 20 }, (_, i) => pageHeader(i + 1)).join(" ");
  const baseEnv = buildEnvelope(boilerplateOnly, "manual_paste");
  const overridden = applyLegislationContentCheck(baseEnv);
  check("already-failed envelope keeps its original hardFailReason", overridden.hardFailReason, baseEnv.hardFailReason);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
