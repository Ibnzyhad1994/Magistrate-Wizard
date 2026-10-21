/**
 * Share item-type widening and canonical Case Law cannot be shared.
 *
 *   npm run test:shares
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isShareableCaseLaw,
  shareNoun,
  shareRecipientNotFound,
  shareRecipientRole,
} from "../../src/lib/shares.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(
  join(__dirname, "../../supabase/migrations/0121_widen_shares_item_type.sql"),
  "utf8",
);

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

check(
  "migration looks up the live item_type check in pg_constraint",
  sql.includes("pg_constraint") && sql.includes("item_type"),
  true,
);
check(
  "migration does not assume shares_item_type_check when dropping",
  /drop constraint shares_item_type_check/i.test(
    sql.split("add constraint shares_item_type_check")[0],
  ),
  false,
);
check(
  "allowed item types include docket_matter, judgment, and case_law",
  sql.includes("'docket_matter'") && sql.includes("'judgment'") && sql.includes("'case_law'"),
  true,
);
check(
  "canonical Case Law is rejected in the existence trigger",
  sql.includes("canonical Case Law cannot be shared") && sql.includes("owner_id is not null"),
  true,
);
check("personal case law can be shared", isShareableCaseLaw("user-a"), true);
check("canonical case law cannot be shared", isShareableCaseLaw(null), false);
check("missing owner cannot be shared", isShareableCaseLaw(undefined), false);
check("docket noun", shareNoun("docket_matter"), "matter");
check("judgment noun", shareNoun("judgment"), "judgment");
check("case law noun", shareNoun("case_law"), "research entry");

// 0165 (C-09): clerks can never open judgments or research, so the share
// dialog asks for a magistrate and explains an empty lookup that way.
check(
  "a matter can go to a magistrate or clerk",
  shareRecipientRole("docket_matter"),
  "magistrate or clerk",
);
check("a judgment goes to a magistrate", shareRecipientRole("judgment"), "magistrate");
check("research goes to a magistrate", shareRecipientRole("case_law"), "magistrate");
check(
  "an empty judgment lookup names who can receive it",
  shareRecipientNotFound("judgment"),
  "No one found with that email. Check the address. They must be an active magistrate who sits a court, and you must be able to share this judgment.",
);
check(
  "an empty matter lookup keeps the any-active-user wording",
  shareRecipientNotFound("docket_matter"),
  "No one found with that email. Check the address. They must be an active user, and you must be able to share this matter.",
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
