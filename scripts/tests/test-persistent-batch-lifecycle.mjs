// Regression tests for the PERSISTENT BULK INGESTION LIFECYCLE pass
// (Magistrate Wizard — AUTONOMOUS DEVELOPMENT, DEBUGGING, TESTING & PERSISTENT
// BULK INGESTION PASS). Covers the PURE, dependency-free layer only —
// error-message mapping (src/lib/utils.ts) and the bare-job-row read
// helpers (src/hooks/legal-library/use-import-jobs.ts). Everything else
// introduced by this pass (checkCanonicalCitationConflict,
// recordBulkNonDraftJob, recordBulkRejectedJobs, useImportBatches,
// useImportBatchDetail) is a thin wrapper directly over Supabase queries/
// RPCs with no independent logic worth re-testing here in isolation —
// those were instead exercised as genuine integration tests directly
// against the live Supabase project via the Supabase MCP (documented in
// the final report, not re-creatable in this offline harness since it
// requires a real authenticated admin session and real constraint/RLS
// enforcement that a stubbed client cannot reproduce honestly).
//
// Run with:
//   node --experimental-strip-types --import ./scripts/test-support/register.mjs scripts/tests/test-persistent-batch-lifecycle.mjs

import { getErrorMessage } from "@/lib/utils";
import { readBareJobFilename, readDuplicateOfId } from "@/hooks/legal-library/use-import-jobs";

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
function checkTrue(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"} - ${label}`);
  if (!cond) failures += 1;
}

function main() {
  // The exact raw Postgres error this pass's live testing reproduced
  // (verbatim text captured against the real live project via the
  // Supabase MCP: calling create_case_law_import a second time with a
  // citation that already exists on a canonical row raises this literal
  // 23505 with this literal constraint name).
  {
    const liveError = {
      code: "23505",
      message:
        'duplicate key value violates unique constraint "case_law_citation_canonical_unique_idx"\nDETAIL:  Key (citation)=([2026] TEST 1) already exists.',
    };
    check(
      "citation-conflict 23505 maps to the friendly, non-generic message (root-cause fix)",
      getErrorMessage(liveError),
      "A canonical case with this citation already exists.",
    );
    checkTrue(
      "citation-conflict message is NOT the old misleading generic fallback",
      getErrorMessage(liveError) !== "That already exists.",
    );
  }

  // An UNRECOGNIZED unique violation must still fall back to the generic
  // message — this mapping is additive, not a replacement for the
  // fallback safety net.
  {
    const unknownViolation = { code: "23505", message: 'duplicate key value violates unique constraint "some_other_constraint_never_seen_before"' };
    check("an unmapped 23505 still falls back to the generic message", getErrorMessage(unknownViolation), "That already exists.");
  }

  // Pre-existing mappings must still work (this pass only ADDED an entry,
  // never touched the others).
  {
    const bookmarkViolation = { code: "23505", message: 'duplicate key value violates unique constraint "bookmarks_user_id_entity_type_entity_id"' };
    check("pre-existing bookmark mapping untouched by this pass's addition", getErrorMessage(bookmarkViolation), "You've already bookmarked this.");
  }

  // readBareJobFilename / readDuplicateOfId — the read-side of the "bare
  // job row" architecture (recordBulkNonDraftJob's write side can't be
  // tested offline; it's a real Supabase insert, verified live instead).
  {
    check("readBareJobFilename reads _originalFilename from a bare job's extracted_metadata", readBareJobFilename({ _originalFilename: "TEST_State_v_Beta_copy.pdf", _duplicateOfId: "abc-123" }), "TEST_State_v_Beta_copy.pdf");
    check("readDuplicateOfId reads _duplicateOfId from a bare job's extracted_metadata", readDuplicateOfId({ _originalFilename: "TEST_State_v_Beta_copy.pdf", _duplicateOfId: "abc-123" }), "abc-123");
    check("readDuplicateOfId is null when the field is explicitly null (a failed job, not a duplicate)", readDuplicateOfId({ _originalFilename: "TEST_Malformed_Fixture.pdf", _duplicateOfId: null }), null);
    check("readBareJobFilename returns null for a normal draft-creating job's metadata (no _originalFilename key at all)", readBareJobFilename({ neutral_citation: "[2026] TEST 1" }), null);
    check("readBareJobFilename is defensive against non-object input", readBareJobFilename(null), null);
    check("readBareJobFilename is defensive against a non-string value under the key", readBareJobFilename({ _originalFilename: 12345 }), null);
    check("readDuplicateOfId is defensive against non-object input", readDuplicateOfId(undefined), null);
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
