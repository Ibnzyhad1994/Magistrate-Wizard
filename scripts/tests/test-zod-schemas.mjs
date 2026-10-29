/**
 * Representative zod schemas accept, reject and word their errors exactly as
 * they did before the zod 4 upgrade. Every message pinned here is one a form
 * shows under its field, or one an RPC-result error carries to Sentry.
 *
 *   - Custom messages on enums replace both "missing" and "not an option".
 *   - The party role is "Role is required" only when no role is chosen.
 *   - Default messages keep their zod 3 wording ("Required", "String must
 *     contain at most 300 character(s)", "Invalid email", ...).
 *   - Register's cross-field checks wait until every field has the right type.
 *   - Ids are any 8-4-4-4-12 hex string, not only RFC version-4 UUIDs.
 *   - Defaults fill missing fields, transforms (trim) still apply, and a URL
 *     is submitted as typed.
 *
 *   npm run test:zod-schemas
 */
import { loginSchema, registerSchema } from "../../src/lib/validations/auth.ts";
import { benchNoteCreateSchema } from "../../src/lib/validations/bench-note.ts";
import { caseLawFieldsSchema } from "../../src/lib/validations/case-law.ts";
import {
  createShareSchema,
  docketEventSchema,
  docketMatterSchema,
  docketPartySchema,
} from "../../src/lib/validations/docket.ts";
import { judgmentCreateSchema } from "../../src/lib/validations/judgment.ts";
import { auditLedgerRowSchema } from "../../src/lib/audit-ledger-export.ts";
import { RPC_RESULT_SCHEMAS } from "../../src/lib/rpc-results.ts";

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

/** Every issue as "path: message", in the order a form would see them. */
const issues = (schema, input) => {
  const result = schema.safeParse(input);
  return result.success
    ? []
    : result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
};

// --- login -------------------------------------------------------------------
check(
  "login: a valid email and password pass, rememberMe defaults to false",
  loginSchema.safeParse({ email: "clerk@court.gov.tt", password: "x" }).data,
  { email: "clerk@court.gov.tt", password: "x", rememberMe: false },
);
check(
  "login: blank fields say what is required",
  issues(loginSchema, { email: "", password: "" }),
  [
    "email: Email is required",
    "email: Enter a valid email address",
    "password: Password is required",
  ],
);
check("login: a missing field is Required", issues(loginSchema, { email: "a@b.co" }), [
  "password: Required",
]);
for (const email of ["a@b", "a..b@c.com", ".a@b.com", "a@-b.com", "a b@c.com", "a@b.c"]) {
  check(
    `login: ${email} is not an email`,
    loginSchema.safeParse({ email, password: "x" }).success,
    false,
  );
}
for (const email of ["o'neil@court.gov.tt", "a+tag@b.co", "A.B@Example.COM"]) {
  check(
    `login: ${email} is an email`,
    loginSchema.safeParse({ email, password: "x" }).success,
    true,
  );
}

// --- register ----------------------------------------------------------------
const registration = (overrides = {}) => ({
  accountType: "clerk",
  fullName: "Jane Clerk",
  email: "jane@court.gov.tt",
  password: "Good-Pass-2026",
  confirmPassword: "Good-Pass-2026",
  districtId: "district-1",
  courtIds: ["court-1"],
  ...overrides,
});
check("register: a complete form passes", registerSchema.safeParse(registration()).success, true);
check(
  "register: no account type gets the custom message, and the cross-field checks wait",
  issues(registerSchema, registration({ accountType: undefined, districtId: undefined })),
  ["accountType: Choose Magistrate or Court Clerk"],
);
check(
  "register: an account type outside the list gets the same message",
  issues(registerSchema, registration({ accountType: "admin" })),
  ["accountType: Choose Magistrate or Court Clerk"],
);
check(
  "register: every cross-field check reports, in order",
  issues(
    registerSchema,
    registration({ confirmPassword: "Other1Pass", districtId: "", courtIds: [] }),
  ),
  [
    "confirmPassword: Passwords do not match",
    "districtId: Select your Magisterial District",
    "courtIds: Select at least one court to request access to",
  ],
);
check(
  "register: the password rules all report",
  issues(registerSchema, registration({ password: "abc", confirmPassword: "abc" })),
  [
    "password: Password must be at least 12 characters",
    "password: Password must contain an uppercase letter",
    "password: Password must contain a number",
    "password: Password must contain a symbol, such as ! ? # or -",
  ],
);
check(
  "register: a field check failing still lets the cross-field checks run",
  issues(registerSchema, registration({ fullName: "J", courtIds: [] })),
  [
    "fullName: Full name must be at least 2 characters",
    "courtIds: Select at least one court to request access to",
  ],
);

// --- bench note --------------------------------------------------------------
check(
  "bench note: an unknown parent type gets the custom message",
  issues(benchNoteCreateSchema, { title: "T", entity_type: "statute_section", entity_id: "x" }),
  ["entity_type: Choose what this note is about"],
);
check(
  "bench note: a long title gets zod's length message",
  issues(benchNoteCreateSchema, {
    title: "x".repeat(301),
    entity_type: "judgment",
    entity_id: "x",
  }),
  ["title: String must contain at most 300 character(s)"],
);

// --- docket ------------------------------------------------------------------
check("party: no role chosen is Role is required", issues(docketPartySchema, { full_name: "A" }), [
  "role: Role is required",
]);
check(
  "party: a role outside the list names the options",
  issues(docketPartySchema, { full_name: "A", role: "judge" }),
  [
    "role: Invalid enum value. Expected 'accused' | 'complainant' | 'applicant' | 'respondent' | 'plaintiff' | 'defendant' | 'petitioner' | 'appellant' | 'appellee' | 'landlord' | 'tenant' | 'child' | 'other', received 'judge'",
  ],
);
check(
  "party: defaults fill party_type and party_status",
  docketPartySchema.safeParse({ full_name: "A", role: "accused" }).data,
  { full_name: "A", party_type: "individual", role: "accused", party_status: "active" },
);
check(
  "matter: status defaults to active and the title is trimmed",
  (({ status, matter_title }) => ({ status, matter_title }))(
    docketMatterSchema.safeParse({
      court_id: "c",
      district_id: "d",
      case_number: "B-1",
      matter_title: "  Police v. Accused ",
      category_id: "k",
    }).data ?? {},
  ),
  { status: "active", matter_title: "Police v. Accused" },
);
check(
  "matter: a brought-forward status outside the list is refused",
  docketMatterSchema.safeParse({
    court_id: "c",
    district_id: "d",
    case_number: "B-1",
    matter_title: "T",
    category_id: "k",
    trial_status: "nonsense",
  }).success,
  false,
);
check(
  "event: an optional text field may be blank, missing, or within its limit",
  [undefined, "", "Court 3"].map(
    (location) => docketEventSchema.safeParse({ scheduled_date: "2026-11-02", location }).success,
  ),
  [true, true, true],
);
check(
  "event: an over-long optional field reports the limit",
  issues(docketEventSchema, { scheduled_date: "2026-11-02", location: "x".repeat(301) }),
  ["location: String must contain at most 300 character(s)"],
);
check(
  "share: an invalid recipient email says Invalid email",
  issues(createShareSchema, { recipient_email: "nope" }),
  ["recipient_email: Invalid email"],
);
check(
  "share: permission defaults to view",
  createShareSchema.safeParse({ recipient_email: "a@b.co" }).data?.permission,
  "view",
);

// --- judgment and case law ---------------------------------------------------
check(
  "judgment: a blank optional field passes",
  judgmentCreateSchema.safeParse({ title: "T", case_number: "", citation: "" }).success,
  true,
);
check(
  "judgment: a wrong type in an optional-or-blank field is Invalid input",
  issues(judgmentCreateSchema, { title: "T", citation: 12 }),
  ["citation: Invalid input"],
);
const caseLaw = (source_url) => ({
  case_name: "A v B",
  citation: "[2020] TT 1",
  court: "CA",
  jurisdiction: "TT",
  source_url,
});
check(
  "case law: an http(s) URL or a blank passes",
  ["https://webopac.ttlawcourts.org/x", ""].map(
    (u) => caseLawFieldsSchema.safeParse(caseLaw(u)).success,
  ),
  [true, true],
);
check(
  "case law: a URL is submitted exactly as typed",
  caseLawFieldsSchema.safeParse(caseLaw(" https://example.org/a ")).data?.source_url,
  " https://example.org/a ",
);
check("case law: not a URL says so", issues(caseLawFieldsSchema, caseLaw("not a url")), [
  "source_url: Enter a valid URL",
  "source_url: Enter an http(s) URL",
]);
check(
  "case law: a javascript: URL is refused",
  issues(caseLawFieldsSchema, caseLaw("javascript:alert(1)")),
  ["source_url: Enter an http(s) URL"],
);

// --- data boundaries (audit export, RPC results) ------------------------------
const ledgerRow = (overrides = {}) => ({
  id: 1,
  created_at: "2026-10-28T00:00:00Z",
  action: "update",
  table_name: "docket_matters",
  record_id: "00000000-0000-0000-0000-000000000001",
  actor_id: "A1B2C3D4-E5F6-1234-5678-9ABCDEF01234",
  actor_name: null,
  actor_email: null,
  old_data: null,
  new_data: { a: 1 },
  prev_hash: null,
  row_hash: "h",
  ...overrides,
});
check(
  "audit row: ids that are hex 8-4-4-4-12 pass, whatever their version bits",
  auditLedgerRowSchema.safeParse(ledgerRow()).success,
  true,
);
check(
  "audit row: a malformed id and a fractional row id word their errors as before",
  issues(auditLedgerRowSchema, ledgerRow({ id: 1.5, record_id: "not-a-uuid", action: "drop" })),
  [
    "id: Expected integer, received float",
    "action: Invalid enum value. Expected 'insert' | 'update' | 'delete', received 'drop'",
    "record_id: Invalid uuid",
  ],
);
check("audit row: a zero id is not positive", issues(auditLedgerRowSchema, ledgerRow({ id: 0 })), [
  "id: Number must be greater than 0",
]);
check(
  "rpc result: a missing next date passes, a malformed one names the format",
  [
    RPC_RESULT_SCHEMAS.find_next_available_docket_date.safeParse(null).success,
    issues(RPC_RESULT_SCHEMAS.find_next_available_docket_date, "02/11/2026"),
  ],
  [true, ["(root): expected a YYYY-MM-DD date"]],
);
check(
  "rpc result: a null where a count must be an integer is Expected number",
  issues(RPC_RESULT_SCHEMAS.get_docket_capacity_snapshot, [
    {
      category_id: null,
      category_name: null,
      daily_capacity: 2.5,
      scheduled_count: null,
      status: null,
      total_matters_count: "3",
    },
  ]),
  [
    "0.daily_capacity: Expected integer, received float",
    "0.total_matters_count: Expected number, received string",
  ],
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
