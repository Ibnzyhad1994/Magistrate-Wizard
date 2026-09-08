import {
  CALLOVER_OUTCOMES,
  CALLOVER_OUTCOME_VALUES,
  CALLOVER_STATUSES,
  calloverOutcomeMeta,
  calloverProgress,
  defaultCalloverTitle,
  isCalloverEditable,
  isCalloverStatus,
  itemsMissingExpectedNextDate,
  outcomeExpectsNextDate,
  outcomeSuggestsCompletion,
  sortCalloverItems,
} from "../../src/lib/callover.ts";
import { currentStage } from "../../src/lib/docket-procedure.ts";

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

const item = (over = {}) => ({
  id: "i", sort_order: 0, called_at: null, outcome: null, next_date: null, created_at: "2026-09-11T09:00:00Z",
  ...over,
});

// --- status ---------------------------------------------------------------

check("the three sitting statuses are the ones the CHECK constraint allows",
  [...CALLOVER_STATUSES], ["draft", "in_progress", "completed"]);
check("a known status is recognised", isCalloverStatus("in_progress"), true);
check("an unknown status is rejected", isCalloverStatus("archived"), false);
check("a non-string status is rejected", isCalloverStatus(null), false);

check("a draft sitting is editable", isCalloverEditable("draft"), true);
check("an in-progress sitting is editable", isCalloverEditable("in_progress"), true);
check("a COMPLETED sitting is read-only", isCalloverEditable("completed"), false);
check("an absent status does not accidentally lock the sheet", isCalloverEditable(undefined), true);

// --- outcome vocabulary ---------------------------------------------------

check("every outcome value is unique",
  CALLOVER_OUTCOME_VALUES.length, new Set(CALLOVER_OUTCOME_VALUES).size);

check("Adjourned expects a return date", outcomeExpectsNextDate("Adjourned"), true);
check("Trial date set expects a return date", outcomeExpectsNextDate("Trial date set"), true);
check("Struck out does not expect a return date", outcomeExpectsNextDate("Struck out"), false);
check("Not called does not expect a return date", outcomeExpectsNextDate("Not called"), false);

check("Struck out suggests completing the matter", outcomeSuggestsCompletion("Struck out"), true);
check("Withdrawn suggests completing the matter", outcomeSuggestsCompletion("Withdrawn"), true);
check("Concluded suggests completing the matter", outcomeSuggestsCompletion("Concluded"), true);
check("Adjourned never suggests completing the matter", outcomeSuggestsCompletion("Adjourned"), false);

check("an outcome that suggests completion never also expects a return date",
  CALLOVER_OUTCOMES.filter((o) => o.suggestsCompletion && o.expectsNextDate), []);

// Free text must survive: the column is unconstrained on purpose.
check("free-text outcome is accepted and simply carries no hints",
  calloverOutcomeMeta("Referred to the DPP"), null);
check("free-text outcome expects no date", outcomeExpectsNextDate("Referred to the DPP"), false);
check("free-text outcome suggests no completion", outcomeSuggestsCompletion("Referred to the DPP"), false);
check("a null outcome is handled", calloverOutcomeMeta(null), null);

// --- ordering -------------------------------------------------------------

check("items sort by sort_order",
  sortCalloverItems([
    item({ id: "c", sort_order: 3 }),
    item({ id: "a", sort_order: 1 }),
    item({ id: "b", sort_order: 2 }),
  ]).map((i) => i.id),
  ["a", "b", "c"]);

check("a tied sort_order falls back to created_at, so rows never swap between renders",
  sortCalloverItems([
    item({ id: "later", sort_order: 1, created_at: "2026-09-11T10:00:00Z" }),
    item({ id: "earlier", sort_order: 1, created_at: "2026-09-11T09:00:00Z" }),
  ]).map((i) => i.id),
  ["earlier", "later"]);

check("sorting does not move called rows — the magistrate keeps their place",
  sortCalloverItems([
    item({ id: "a", sort_order: 1, called_at: "2026-09-11T09:05:00Z" }),
    item({ id: "b", sort_order: 2 }),
    item({ id: "c", sort_order: 3, called_at: "2026-09-11T09:10:00Z" }),
  ]).map((i) => i.id),
  ["a", "b", "c"]);

check("sorting does not mutate the input array", (() => {
  const input = [item({ id: "b", sort_order: 2 }), item({ id: "a", sort_order: 1 })];
  sortCalloverItems(input);
  return input.map((i) => i.id);
})(), ["b", "a"]);

// --- progress -------------------------------------------------------------

check("an empty list reports zero rather than NaN",
  calloverProgress([]), { total: 0, called: 0, remaining: 0, percent: 0 });

check("progress counts called rows",
  calloverProgress([
    item({ called_at: "2026-09-11T09:05:00Z" }),
    item({ called_at: "2026-09-11T09:06:00Z" }),
    item(),
    item(),
  ]),
  { total: 4, called: 2, remaining: 2, percent: 50 });

check("a fully-called list reports 100",
  calloverProgress([item({ called_at: "x" })]),
  { total: 1, called: 1, remaining: 0, percent: 100 });

// --- pre-completion warnings ---------------------------------------------

check("flags a called Adjourned row left without a return date",
  itemsMissingExpectedNextDate([
    item({ id: "flagme", called_at: "x", outcome: "Adjourned", next_date: null }),
  ]).map((i) => i.id),
  ["flagme"]);

check("does not flag an Adjourned row that HAS a return date",
  itemsMissingExpectedNextDate([
    item({ called_at: "x", outcome: "Adjourned", next_date: "2026-10-03" }),
  ]),
  []);

check("does not flag an uncalled row, however it is left",
  itemsMissingExpectedNextDate([
    item({ called_at: null, outcome: "Adjourned", next_date: null }),
  ]),
  []);

check("does not flag Struck out, which legitimately has no return date",
  itemsMissingExpectedNextDate([
    item({ called_at: "x", outcome: "Struck out", next_date: null }),
  ]),
  []);

// --- title ----------------------------------------------------------------

check("a malformed date still yields a usable title", defaultCalloverTitle("not-a-date"), "Callover");
check("a valid date yields a dated title", defaultCalloverTitle("2026-09-11").startsWith("Callover — "), true);

// --- the intake promise ---------------------------------------------------
// The whole point of brought-forward intake is that seeding the eight
// status columns lands the matter at its REAL stage. procedure_stage is a
// generated column (0070) computed by exactly this walk, so if these ever
// disagree the preview in the create dialog would lie.

const seeded = {
  arraignment_status: "done",
  custody_status: "on_bail",
  disclosure_status: "full",
  trial_status: "partial",
  ruling_status: "not_started",
  judgment_status: "not_started",
  sentence_status: "not_started",
  appeal_status: "not_started",
};
check("a part-heard matter seeds to Trial, not Arraignment", currentStage(seeded), "trial");

check("an unseeded matter still starts at Arraignment", currentStage({
  arraignment_status: "not_started",
  custody_status: "unset",
  disclosure_status: "none",
  trial_status: "not_commenced",
  ruling_status: "not_started",
  judgment_status: "not_started",
  sentence_status: "not_started",
  appeal_status: "not_started",
}), "arraignment");

check("a fully-disposed matter seeds to Appeal", currentStage({
  arraignment_status: "done",
  custody_status: "on_bail",
  disclosure_status: "full",
  trial_status: "completed",
  ruling_status: "delivered",
  judgment_status: "delivered",
  sentence_status: "passed",
  appeal_status: "not_started",
}), "appeal");

if (failures > 0) {
  console.log(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log("\nAll callover tests passed.");
