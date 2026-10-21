/**
 * The forms' zod rules agree with the database's (0166, audit B-14 and C-12).
 *
 *   - A case number or matter title of only whitespace is blank, and the
 *     values the dialogs submit are trimmed, as docket_matters_trim_text()
 *     stores them.
 *   - The length limits are counted after trimming, as the CHECKs count them.
 *   - Quick Code content is capped at 20,000 characters.
 *   - The create dialog's live duplicate check compares case numbers the way
 *     the unique index does (case and surrounding whitespace ignored), and its
 *     ILIKE pattern matches `%` and `_` literally.
 *
 *   npm run test:input-validation
 */
import {
  docketMatterIdentitySchema,
  docketMatterSchema,
  docketMatterSchemaForCategories,
} from "../../src/lib/validations/docket.ts";
import { quickCodeFieldsSchema } from "../../src/lib/validations/quick-code.ts";
import {
  caseNumberKey,
  escapeLikePattern,
  isSameCaseNumber,
} from "../../src/lib/docket-case-number.ts";

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

const matter = (overrides = {}) => ({
  court_id: "court-1",
  district_id: "district-1",
  case_number: "B-12/2026",
  matter_title: "Police v. Accused",
  charge_or_issue: "Larceny",
  category_id: "category-1",
  ...overrides,
});
const errorFor = (result, field) =>
  result.success ? null : (result.error.issues.find((i) => i.path[0] === field)?.message ?? null);

// --- docket matter: blank and trimmed ---------------------------------------
{
  const parsed = docketMatterSchema.safeParse(
    matter({ case_number: "  B-12/2026 ", matter_title: "\tPolice v. Accused  " }),
  );
  check("a padded case number and title are accepted", parsed.success, true);
  check("the case number is submitted trimmed", parsed.data?.case_number, "B-12/2026");
  check("the title is submitted trimmed", parsed.data?.matter_title, "Police v. Accused");
}
check(
  "a title of three spaces is refused",
  errorFor(docketMatterSchema.safeParse(matter({ matter_title: "   " })), "matter_title"),
  "Matter title is required",
);
check(
  "an empty title is refused",
  errorFor(docketMatterSchema.safeParse(matter({ matter_title: "" })), "matter_title"),
  "Matter title is required",
);
check(
  "a case number of spaces is refused",
  errorFor(docketMatterSchema.safeParse(matter({ case_number: "     " })), "case_number"),
  "Case number is required",
);
check(
  "a no-break-space title is blank too, as btrim_whitespace() sees it",
  errorFor(docketMatterSchema.safeParse(matter({ matter_title: " 　" })), "matter_title"),
  "Matter title is required",
);
check(
  "a charge of spaces is submitted empty",
  docketMatterSchema.safeParse(matter({ charge_or_issue: "   " })).data?.charge_or_issue,
  "",
);
check(
  "the inside of a case number is never touched",
  docketMatterSchema.safeParse(matter({ case_number: " B 12 / 2026 " })).data?.case_number,
  "B 12 / 2026",
);

// --- docket matter: lengths counted after trimming --------------------------
check(
  "a 300-character title with padding is accepted",
  docketMatterSchema.safeParse(matter({ matter_title: `  ${"t".repeat(300)}  ` })).success,
  true,
);
check(
  "a 301-character title is refused",
  docketMatterSchema.safeParse(matter({ matter_title: "t".repeat(301) })).success,
  false,
);
check(
  "a 1,000,000-character title is refused",
  docketMatterSchema.safeParse(matter({ matter_title: "z".repeat(1_000_000) })).success,
  false,
);
check(
  "a 101-character case number is refused",
  docketMatterSchema.safeParse(matter({ case_number: "9".repeat(101) })).success,
  false,
);
check(
  "a 2,001-character charge is refused",
  docketMatterSchema.safeParse(matter({ charge_or_issue: "c".repeat(2001) })).success,
  false,
);

// --- the dialogs that use the schema ----------------------------------------
check(
  "the create dialog's schema (with categories) trims too",
  docketMatterSchemaForCategories("other-id").safeParse(matter({ case_number: " B-1 " })).data
    ?.case_number,
  "B-1",
);
check(
  "the create dialog's schema refuses a blank title",
  errorFor(
    docketMatterSchemaForCategories("other-id").safeParse(matter({ matter_title: "  " })),
    "matter_title",
  ),
  "Matter title is required",
);
check(
  "Edit details refuses a blank title",
  errorFor(
    docketMatterIdentitySchema.safeParse({ case_number: "B-1", matter_title: "   " }),
    "matter_title",
  ),
  "Matter title is required",
);

// --- Quick Code content cap -------------------------------------------------
const quickCode = (content) => ({ code_word: "adj", content });
check(
  "20,000 characters of Quick Code content is accepted",
  quickCodeFieldsSchema.safeParse(quickCode("q".repeat(20_000))).success,
  true,
);
check(
  "20,001 characters is refused, with a sentence",
  errorFor(quickCodeFieldsSchema.safeParse(quickCode("q".repeat(20_001))), "content"),
  "Content can be at most 20,000 characters",
);

// --- duplicate check, as the unique index compares --------------------------
check("caseNumberKey trims and upper-cases", caseNumberKey("  b-dup-1\t"), "B-DUP-1");
check("letter case does not make a new number", isSameCaseNumber("B-DUP-1", "b-dup-1"), true);
check("surrounding spaces do not either", isSameCaseNumber("B-DUP-1 ", " B-DUP-1"), true);
check("a different number is different", isSameCaseNumber("B-DUP-1", "B-DUP-2"), false);
check("inner spacing still distinguishes numbers", isSameCaseNumber("B-DUP 1", "B-DUP  1"), false);
check("% is matched literally", escapeLikePattern("100%"), "100\\%");
check("_ is matched literally", escapeLikePattern("A_1"), "A\\_1");
check("a backslash is matched literally", escapeLikePattern("A\\1"), "A\\\\1");
check("ordinary text is unchanged", escapeLikePattern("B-12/2026"), "B-12/2026");

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
