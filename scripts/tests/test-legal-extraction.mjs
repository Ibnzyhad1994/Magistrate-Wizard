// Regression tests for the deterministic Case Law metadata parser
// (src/lib/legal-extraction.ts) and Court matcher
// (src/lib/legal-taxonomy-match.ts) — the REAL shipped modules, imported
// via the at-alias-loader (see scripts/test-support/), not inlined copies.
//
// No test runner (vitest/jest) is configured in this project — run
// directly with:
//   node --experimental-strip-types --import ./scripts/test-support/register.mjs scripts/tests/test-legal-extraction.mjs
//
// Fixture A reproduces the actual text-prefix pattern observed from the
// REAL Ramsingh PDF in this session's live test ("The State v Dhannie
// RamsinghOverview | (1973) 20 WIR 138The State v Dhannie Ramsingh (1973)
// 20 WIR 138COURT OF APPEAL OF GUYANA...", plus a body mentioning "Privy
// Council" and a list of hearing dates) — not a guess, the literal
// reported extraction output. Fixtures B-E are synthetic, built to the
// user's specified patterns, since no other real judgment PDFs were
// available in this sandbox.

import { extractCaseLawMetadata, extractCaseNameFromFilename, shouldAutoFillCaseName } from "@/lib/legal-extraction";
import { matchCanonicalCourtScored } from "@/lib/legal-taxonomy-match";

let failures = 0;
function check(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} — ${label}`);
  if (!pass) {
    console.log("  expected:", JSON.stringify(expected));
    console.log("  actual:  ", JSON.stringify(actual));
    failures += 1;
  }
}

// A minimal slice of the real catalogue, shaped exactly like
// legal_authority_courts rows (post 0062 migration — "Court of Appeal"
// generic alias already removed from Guyana's row).
const COURTS = [
  {
    id: "coa-guyana",
    canonical_name: "Court of Appeal of Guyana",
    short_name: "Guyana Court of Appeal",
    aliases: ["Guyana Court of Appeal", "CoA Guyana"],
    jurisdiction_id: "jur-guyana",
  },
  {
    id: "jcpc",
    canonical_name: "Judicial Committee of the Privy Council",
    short_name: "Privy Council",
    aliases: ["JCPC", "Privy Council", "Judicial Committee of the Privy Council"],
    jurisdiction_id: null,
  },
  {
    id: "ccj",
    canonical_name: "Caribbean Court of Justice",
    short_name: "CCJ",
    aliases: ["CCJ", "Caribbean Court Justice", "Caribbean Court of Justice"],
    jurisdiction_id: null,
  },
];

// ---------------------------------------------------------------------------
// A. Ramsingh-style header — the literal text-prefix pattern actually
// produced by the real PDF, extended with a body mentioning "Privy
// Council" (as the real judgment does, discussing further appeal rights)
// and a cluster of hearing dates plus one date that looks like a decision
// date but has no "delivered"/"decided" anchor near it — must stay blank.
// ---------------------------------------------------------------------------
{
  const ramsinghText =
    "The State v Dhannie RamsinghOverview | (1973) 20 WIR 138" +
    "The State v Dhannie Ramsingh (1973) 20 WIR 138" +
    "COURT OF APPEAL OF GUYANA\n\n" +
    "Heard: 5, 6, 7, 9, 12, 14 February; 22 March 1973\n\n" +
    "The appellant was convicted of manslaughter. On appeal, counsel submitted " +
    "that certain admissions were wrongly admitted as hearsay. The court considered " +
    "prior authorities. It was noted that a further appeal in a proper case would lie " +
    "to the Privy Council, and reference was made to a decision of the Privy Council " +
    "on a similar point of evidence law discussed at length in this judgment.";

  const meta = extractCaseLawMetadata(ramsinghText);
  check("A. case_name", meta.case_name, "The State v Dhannie Ramsingh");
  check("A. reported_citation", meta.reported_citation, "(1973) 20 WIR 138");
  check("A. decided_date_guess left blank (no anchor)", meta.decided_date_guess, undefined);

  const court = matchCanonicalCourtScored(ramsinghText, COURTS);
  check("A. court matched", court?.court.id, "coa-guyana");
  check("A. court confidence high", court?.confidence, "high");
}

// ---------------------------------------------------------------------------
// B. Body reference to another court must not outrank an explicit header.
// ---------------------------------------------------------------------------
{
  const text =
    "Re Test Appeal (1980) 5 WIR 200\nCOURT OF APPEAL OF GUYANA\n\n" +
    "The Privy Council has considered similar questions on several occasions. " +
    "This court respectfully agrees with the reasoning of the Privy Council in " +
    "an earlier case, and notes that the Privy Council's approach to hearsay is " +
    "instructive, as is a further Privy Council authority cited by counsel.";
  const court = matchCanonicalCourtScored(text, COURTS);
  check("B. court matched (header wins over repeated body mentions)", court?.court.id, "coa-guyana");
}

// ---------------------------------------------------------------------------
// C. Genuine Privy Council case.
// ---------------------------------------------------------------------------
{
  const text = "Some Appellant v Some Respondent [1990] UKPC 12\nJUDICIAL COMMITTEE OF THE PRIVY COUNCIL\n\nBody text.";
  const court = matchCanonicalCourtScored(text, COURTS);
  check("C. court matched", court?.court.id, "jcpc");
  check("C. confidence high", court?.confidence, "high");
}

// ---------------------------------------------------------------------------
// D. Genuine CCJ case.
// ---------------------------------------------------------------------------
{
  const text = "Some Appellant v Some Respondent [2015] CCJ 4\nCARIBBEAN COURT OF JUSTICE\n\nBody text.";
  const court = matchCanonicalCourtScored(text, COURTS);
  check("D. court matched", court?.court.id, "ccj");
  check("D. confidence high", court?.confidence, "high");
}

// ---------------------------------------------------------------------------
// E. Ambiguous document — no reliable court header at all.
// ---------------------------------------------------------------------------
{
  const text =
    "Some Appellant v Some Respondent\n\n" +
    "This is a judgment concerning a contractual dispute. No court heading is " +
    "printed in this extracted text at all, and no recognizable court name " +
    "appears anywhere in the document.";
  const court = matchCanonicalCourtScored(text, COURTS);
  check("E. court left unset (Needs Review)", court, null);
}

// ---------------------------------------------------------------------------
// Citation-extraction non-regression (§11) — must survive the header
// rewrite unchanged for both reported and neutral citation formats.
// ---------------------------------------------------------------------------
{
  const reported = extractCaseLawMetadata("Some Case (1973) 20 WIR 138\nCOURT OF APPEAL OF GUYANA");
  check("Citation regression — reported", reported.reported_citation, "(1973) 20 WIR 138");

  const neutral = extractCaseLawMetadata("Some Case [2015] CCJ 4\nCARIBBEAN COURT OF JUSTICE");
  check("Citation regression — neutral", neutral.neutral_citation, "[2015] CCJ 4");
}

// ---------------------------------------------------------------------------
// Decision date IS proposed when a clear "delivered on" anchor exists.
// ---------------------------------------------------------------------------
{
  const text = "Some Case v Another (1999) 1 WLR 55\nCOURT OF APPEAL\n\nJudgment delivered on 3 June 1999.";
  const meta = extractCaseLawMetadata(text);
  check("Decision date proposed with clear anchor", meta.decided_date_guess, "1999-06-03");
}

// ---------------------------------------------------------------------------
// Phase F/G (generalized citation formats) — the citation regex family was
// broadened to cover period-delimited reporter abbreviations and the
// unbracketed "YYYY ABBREV NUM" medium-neutral-citation layout used by
// CanLII, Canadian appellate courts, the CCJ, and the UK/NI/Ireland neutral
// citation scheme, on top of the previously-supported bracketed/reported
// forms. Deliberately generic fixtures — none is Ramsingh/Diaz/Canada-
// specific, per the explicit anti-overfitting instruction (Phase S).
// ---------------------------------------------------------------------------
{
  const periodDelimited = extractCaseLawMetadata("Some Case [1969] S.C.R. 525\nSUPREME COURT OF CANADA");
  check("Citation generalization — period-delimited bracketed reporter", periodDelimited.neutral_citation, "[1969] S.C.R. 525");

  const canlii = extractCaseLawMetadata("Some Case 1987 CanLII 16\nCOURT OF APPEAL FOR ONTARIO");
  check("Citation generalization — unbracketed CanLII", canlii.neutral_citation, "1987 CanLII 16");

  const nsca = extractCaseLawMetadata("Some Case 2011 NSCA 42\nNOVA SCOTIA COURT OF APPEAL");
  check("Citation generalization — unbracketed NSCA", nsca.neutral_citation, "2011 NSCA 42");

  const ccj = extractCaseLawMetadata("Some Case 2020 CCJ 1\nCARIBBEAN COURT OF JUSTICE");
  check("Citation generalization — unbracketed CCJ", ccj.neutral_citation, "2020 CCJ 1");

  // False-positive guard: an ordinary capitalized word directly after a
  // bare year must NOT be mistaken for a court/reporter abbreviation —
  // this is the entire reason the unbracketed alternative requires at
  // least two uppercase letters in the abbreviation token.
  const ordinaryProse = extractCaseLawMetadata(
    "This dispute traces back to events described in 1987 Somewhere in the record, long before the hearing.",
  );
  check("Citation generalization — no false positive on ordinary prose", ordinaryProse.neutral_citation, undefined);
}

// ---------------------------------------------------------------------------
// Phase G (filename fallback) — a filename with a citation but no " v "
// party string (common for real archives that name files after the
// citation alone) must still surface the citation as a low-confidence,
// clearly-secondary proposal, independent of case-name detection.
// ---------------------------------------------------------------------------
{
  const spacedCitationOnly = extractCaseNameFromFilename("1969 SCR 525.pdf");
  check("Filename fallback — bare unbracketed citation, no case name", spacedCitationOnly, { neutral_citation: "1969 SCR 525" });

  // A filename with the year/abbreviation/number run together with no
  // separator at all cannot be split without a hard-coded dictionary of
  // known reporter abbreviations — deliberately NOT attempted (Phase S:
  // do not build fixture-specific hacks). Confirms this stays an honest
  // "nothing found" rather than a guessed/garbled result.
  const gluedCitationOnly = extractCaseNameFromFilename("1987canlii16.pdf");
  check("Filename fallback — glued citation with no separator yields nothing (not guessed)", gluedCitationOnly, undefined);

  const noSignal = extractCaseNameFromFilename("scan0042.pdf");
  check("Filename fallback — no case name or citation signal yields nothing", noSignal, undefined);
}

{
  check("OCR never auto-fills case name even at high confidence", shouldAutoFillCaseName("high", true), false);
  check("text-layer high confidence still auto-fills", shouldAutoFillCaseName("high", false), true);
  check("low confidence never auto-fills", shouldAutoFillCaseName("low", false), false);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
