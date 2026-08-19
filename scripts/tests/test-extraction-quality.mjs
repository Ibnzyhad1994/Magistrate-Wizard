// Regression tests for src/lib/extraction-quality.ts - the document-
// agnostic quality gate (Phase 4 of the holistic ingestion repair pass).
// Run with:
//   node --experimental-strip-types --import ./scripts/test-support/register.mjs scripts/tests/test-extraction-quality.mjs

import { assessExtractionQuality } from "@/lib/extraction-quality";

let failures = 0;
function check(label, actual, expected) {
  const pass = actual === expected;
  console.log(`${pass ? "PASS" : "FAIL"} - ${label}`);
  if (!pass) {
    console.log("  expected:", expected);
    console.log("  actual:  ", actual);
    failures += 1;
  }
}

// Clean, genuine judgment prose -- must pass, no hard-fail reason.
{
  const text =
    "The appellant was convicted of manslaughter in the High Court of Guyana. On appeal, " +
    "counsel for the appellant submitted that certain admissions made to police officers were " +
    "wrongly admitted into evidence as they amounted to inadmissible hearsay. The Court of Appeal " +
    "considered the authorities cited, including several decisions from other Commonwealth Caribbean " +
    "jurisdictions, and concluded that the trial judge had correctly directed the jury on the " +
    "admissibility of the confession. The appeal was accordingly dismissed and the conviction affirmed.";
  const q = assessExtractionQuality(text);
  check("clean judgment text passes", q.passed, true);
  check("clean judgment text has no hard-fail reason", q.hardFailReason, undefined);
  check("clean judgment text scores at or above clean threshold", q.score >= 0.75, true);
}

// Document-agnostic per the explicit instruction -- passing does NOT
// depend on containing any particular citation/court/party name.
{
  const genericProse =
    "This is a general piece of prose text with no legal citation, no court name, and no case " +
    "name whatsoever, used purely to confirm the quality gate is checking structure, not content. " +
    "It has normal sentences, normal punctuation, and a normal amount of whitespace throughout.";
  const q = assessExtractionQuality(genericProse);
  check("generic (non-legal) prose still passes the quality gate", q.passed, true);
}

// Font/licensing boilerplate -- real-world pattern from White v R/The
// State, Diaz v The State (embedded font/license material extracted
// instead of judgment content). Must hard-fail with reason "boilerplate".
{
  const boilerplate =
    "This Font Software is licensed under the SIL Open Font License, Version 1.1. " +
    "Reserved Font Name refers to any Reserved Font Name(s). PostScript name: EmbeddedFont. " +
    "TrueType CIDFont OpenType Glyph CMap. Copyright Adobe Systems Incorporated. " +
    "This license permits the licensed fonts to be embedded in documents.";
  const q = assessExtractionQuality(boilerplate);
  check("font/license boilerplate fails the quality gate", q.passed, false);
  check("font/license boilerplate hard-fail reason is boilerplate", q.hardFailReason, "boilerplate");
}

// Binary/garbled decode -- low printable ratio, many control/replacement
// characters. Must hard-fail.
{
  const garbled = Array.from({ length: 400 }, (_, i) => String.fromCharCode(1 + (i % 30))).join("");
  const q = assessExtractionQuality(garbled);
  check("binary-looking garbled text fails the quality gate", q.passed, false);
  check(
    "garbled text hard-fail reason is printable_ratio or control_chars",
    q.hardFailReason === "printable_ratio" || q.hardFailReason === "control_chars",
    true,
  );
}

// Too short -- not enough text to judge at all.
{
  const q = assessExtractionQuality("Short.");
  check("very short text fails the quality gate", q.passed, false);
  check("very short text hard-fail reason is too_short", q.hardFailReason, "too_short");
}

// Repeated missing-glyph / replacement characters.
{
  const boxes =
    "Some readable words here, forming a normal sentence of reasonable length. " +
    "�".repeat(50) +
    " More readable words follow after this point in the text for good measure, " +
    "again forming ordinary sentences so the only anomaly being tested is the replacement characters above.";
  const q = assessExtractionQuality(boxes);
  check("repeated replacement characters fail the quality gate", q.passed, false);
  check("replacement-char hard-fail reason is replacement_chars", q.hardFailReason, "replacement_chars");
}

// Repeated running-header/footer boilerplate -- real-world pattern from a
// bulk Legislation seed audit: 18 published Acts whose "full_text" was
// 100% a gazette running header/footer repeated per page (with only the
// page number/date changing), zero actual enacting text. The old
// character-count-only check ("looks substantial") completely missed
// this; must now hard-fail with reason "repeated_running_header".
{
  const pageHeader = (page) =>
    `THE OFFICIAL GAZETTE ${page} LEGAL SUPPLEMENT A LAWS OF GUYANA A.D. 2025 No. 13 THE OFFICIAL GAZETTE`;
  const gazetteBoilerplate = Array.from({ length: 20 }, (_, i) => pageHeader(i + 1)).join(" ");
  const q = assessExtractionQuality(gazetteBoilerplate);
  check("repeated gazette header/footer fails the quality gate", q.passed, false);
  check(
    "repeated gazette header/footer hard-fail reason is repeated_running_header",
    q.hardFailReason,
    "repeated_running_header",
  );
}

// Regression check: replacement-char detection must still win over the new
// repeated-block check when both could plausibly apply (garbled text that
// also happens to repeat some short fragment) -- the new check must not
// preempt an existing, working signal. Uses the same fixture shape as the
// "Repeated missing-glyph" test above, confirming that pre-existing
// behavior is unchanged now that repeated-block runs earlier in the
// priority ladder.
{
  const boxes =
    "Some readable words here, forming a normal sentence of reasonable length. " +
    "�".repeat(50) +
    " More readable words follow after this point in the text for good measure, " +
    "again forming ordinary sentences so the only anomaly being tested is the replacement characters above.";
  const q = assessExtractionQuality(boxes);
  check("garbled text with replacement chars still fails (unaffected by new check)", q.passed, false);
  check("garbled text still reports replacement_chars, not repeated_running_header", q.hardFailReason, "replacement_chars");
}

// A genuine long document legitimately has a SMALL running header/footer
// repeated on every page (e.g. "Page N" or a short case citation line) --
// this must NOT be penalized. Each "page" below has a real, distinct
// paragraph of substantive content plus one short repeated footer line.
{
  const paragraphs = [
    "The appellant was convicted of manslaughter following a trial in the High Court of Guyana before a judge and jury.",
    "Counsel for the appellant argued that certain admissions made during police questioning were wrongly admitted as evidence.",
    "The Court of Appeal reviewed the transcript of the summing up and considered whether the jury had been properly directed.",
    "Several authorities from other Commonwealth Caribbean jurisdictions were cited on the question of admissibility of confessions.",
    "Having considered the submissions of both parties the Court concluded the trial judge had correctly directed the jury throughout.",
    "The appeal against conviction was accordingly dismissed and the original sentence imposed by the trial judge was affirmed in full.",
  ];
  const withSmallFooter = paragraphs.map((p, i) => `${p} — Judgment continued, page ${i + 1}`).join(" ");
  const q = assessExtractionQuality(withSmallFooter);
  check("long judgment with a small varying page footer still passes", q.passed, true);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
