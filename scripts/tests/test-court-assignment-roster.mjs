import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ASSIGNMENT_TYPE_LABEL,
  canCorrectUnassignedAccountType,
  canSendUnassignedMagistrateBack,
  clerkCourtsUnavailableForNewRequest,
  courtRequestStatusLabel,
  oppositeStaffAccountType,
  pendingRequestsForProfile,
  requestsForProfile,
  waitingListRequestLabel,
} from "@/lib/court-assignment-roster";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql0135 = readFileSync(
  join(__dirname, "../../supabase/migrations/0135_roster_return_unassigned_magistrate.sql"),
  "utf8",
);
const sql0136 = readFileSync(
  join(__dirname, "../../supabase/migrations/0136_court_request_recovery.sql"),
  "utf8",
);
const registerPage = readFileSync(
  join(__dirname, "../../src/pages/auth/register-page.tsx"),
  "utf8",
);
const sql0142 = readFileSync(
  join(__dirname, "../../supabase/migrations/0142_lock_profile_row_in_recovery_rpcs.sql"),
  "utf8",
);
const rosterPanel = readFileSync(
  join(__dirname, "../../src/pages/admin/roster-profile-requests.tsx"),
  "utf8",
);
const adminCourtAssignmentsPage = readFileSync(
  join(__dirname, "../../src/pages/admin/court-assignments-page.tsx"),
  "utf8",
);
const requestsHook = readFileSync(
  join(__dirname, "../../src/hooks/admin/use-magistrate-court-requests.ts"),
  "utf8",
);
const sql0144 = readFileSync(
  join(__dirname, "../../supabase/migrations/0144_clerk_approver_primary_sitting.sql"),
  "utf8",
);
const clerkAccessPage = readFileSync(
  join(__dirname, "../../src/pages/clerk/clerk-access-page.tsx"),
  "utf8",
);
const clerkNotify = readFileSync(
  join(__dirname, "../../supabase/functions/clerk-access-notify/index.ts"),
  "utf8",
);

let failures = 0;
function check(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} — ${label}`);
  if (!pass) {
    console.log("  expected:", expected);
    console.log("  actual:  ", actual);
    failures += 1;
  }
}

const requests = [
  { id: "1", profile_id: "bhoj", status: "cancelled" },
  { id: "2", profile_id: "bhoj", status: "cancelled" },
  { id: "3", profile_id: "other", status: "pending" },
];

check("filters requests to one profile", requestsForProfile(requests, "bhoj").map((r) => r.id), [
  "1",
  "2",
]);
check("pending list is empty when they only cancelled", pendingRequestsForProfile(requests, "bhoj"), []);
check("pending list finds the other person's open row", pendingRequestsForProfile(requests, "other").map((r) => r.id), [
  "3",
]);
check("waiting badge is hidden with no open request", waitingListRequestLabel(0), null);
check("waiting badge for one open request", waitingListRequestLabel(1), "Open request");
check("waiting badge for several open requests", waitingListRequestLabel(2), "2 open requests");

check(
  "unassigned magistrate who is not the admin can be sent back",
  canSendUnassignedMagistrateBack({
    role: "magistrate",
    hasActiveAssignment: false,
    isOwnProfile: false,
  }),
  true,
);
check(
  "assigned magistrate cannot be sent back",
  canSendUnassignedMagistrateBack({
    role: "magistrate",
    hasActiveAssignment: true,
    isOwnProfile: false,
  }),
  false,
);
check(
  "admin cannot send their own profile back",
  canSendUnassignedMagistrateBack({
    role: "magistrate",
    hasActiveAssignment: false,
    isOwnProfile: true,
  }),
  false,
);
check(
  "clerks are not sent back from this roster action",
  canSendUnassignedMagistrateBack({
    role: "clerk",
    hasActiveAssignment: false,
    isOwnProfile: false,
  }),
  false,
);

check("rejected rows display as Returned", courtRequestStatusLabel("rejected"), "Returned");
check("pending rows stay Pending", courtRequestStatusLabel("pending"), "Pending");
check("cancelled rows stay Cancelled", courtRequestStatusLabel("cancelled"), "Cancelled");

check("magistrate flips to clerk", oppositeStaffAccountType("magistrate"), "clerk");
check("clerk flips to magistrate", oppositeStaffAccountType("clerk"), "magistrate");
check("admin has no opposite staff type", oppositeStaffAccountType("admin"), null);

check(
  "unassigned magistrate can be corrected to clerk",
  canCorrectUnassignedAccountType({
    role: "magistrate",
    hasActiveMagistrateAssignment: false,
    hasActiveClerkAssignment: false,
    isOwnProfile: false,
  }),
  true,
);
check(
  "unassigned clerk can be corrected to magistrate",
  canCorrectUnassignedAccountType({
    role: "clerk",
    hasActiveMagistrateAssignment: false,
    hasActiveClerkAssignment: false,
    isOwnProfile: false,
  }),
  true,
);
check(
  "seated magistrate cannot have account type corrected",
  canCorrectUnassignedAccountType({
    role: "magistrate",
    hasActiveMagistrateAssignment: true,
    hasActiveClerkAssignment: false,
    isOwnProfile: false,
  }),
  false,
);
check(
  "clerk with active court cannot have account type corrected",
  canCorrectUnassignedAccountType({
    role: "clerk",
    hasActiveMagistrateAssignment: false,
    hasActiveClerkAssignment: true,
    isOwnProfile: false,
  }),
  false,
);
check(
  "admin cannot correct their own account type",
  canCorrectUnassignedAccountType({
    role: "magistrate",
    hasActiveMagistrateAssignment: false,
    hasActiveClerkAssignment: false,
    isOwnProfile: true,
  }),
  false,
);
check(
  "admin role cannot be corrected from this control",
  canCorrectUnassignedAccountType({
    role: "admin",
    hasActiveMagistrateAssignment: false,
    hasActiveClerkAssignment: false,
    isOwnProfile: false,
  }),
  false,
);

check("migration 0135 adds court_request_decided", sql0135.includes("'court_request_decided'"), true);
check(
  "migration 0135 notifies the requester on reject/approve",
  sql0135.includes("after insert or update on public.magistrate_court_requests") &&
    sql0135.includes("Your court request was not approved"),
  true,
);
check(
  "migration 0135 adds the roster send-back RPC",
  sql0135.includes("return_unassigned_magistrate_to_requester") &&
    sql0135.includes("grant execute on function public.return_unassigned_magistrate_to_requester"),
  true,
);
check(
  "send-back rejects remaining pending rows",
  sql0135.includes("and status = 'pending'") && sql0135.includes("set status = 'rejected'"),
  true,
);

check(
  "0136 returned copy replaces generic rejection",
  sql0136.includes("Your court request was returned") &&
    sql0136.includes("You can request again from Court Assignments"),
  true,
);
check(
  "0136 return RPC requires a reason",
  sql0136.includes("A reason is required so the requester knows what to do next"),
  true,
);
check(
  "0136 adds account-type correction RPC",
  sql0136.includes("correct_unassigned_account_type") &&
    sql0136.includes("grant execute on function public.correct_unassigned_account_type"),
  true,
);
check(
  "0136 blocks converting to admin",
  sql0136.includes("Account type can only be corrected between magistrate and clerk"),
  true,
);
check(
  "0136 blocks correcting a seated magistrate",
  sql0136.includes("End their magistrate court assignment before correcting the account type"),
  true,
);
check(
  "0136 blocks correcting a seated clerk",
  sql0136.includes("End their clerk court access before correcting the account type"),
  true,
);
check(
  "0136 blocks self-correction",
  sql0136.includes("You cannot correct your own account type from this screen"),
  true,
);
check(
  "0136 cancels pending requests of the old type",
  sql0136.includes("update public.magistrate_court_requests") &&
    sql0136.includes("update public.clerk_access_requests") &&
    sql0136.includes("set status = 'cancelled'"),
  true,
);
check(
  "0136 notifies on account_type_corrected",
  sql0136.includes("'account_type_corrected'") &&
    sql0136.includes("Refresh or sign in again, then request access on the correct page."),
  true,
);

check(
  "signup does not default to magistrate",
  !registerPage.includes('accountType: "magistrate"'),
  true,
);
check(
  "signup requires an explicit Magistrate vs Court Clerk choice",
  registerPage.includes("Choose Magistrate or Court Clerk first") &&
    registerPage.includes("You sit the court. A Court Assignment Administrator must approve your court."),
  true,
);

// --- destructive actions are never offered on unknown state ----------------
// Both roster actions are gated on "this person has no open request", which
// is read entirely from useMagistrateCourtRequestsToReview(). While that query
// is loading or has failed, `pending` is an empty array for the same reason it
// would be if there genuinely were none — so the card used to assert "No open
// request" and offer the button either way, letting an admin return someone
// whose request had merely failed to load.

check(
  "roster panel reads the request query's loading and error state",
  rosterPanel.includes("isPending: requestsPending") &&
    rosterPanel.includes("isError: requestsError"),
  true,
);
check(
  "roster panel derives a single requests-known gate",
  rosterPanel.includes("const requestsKnown = !requestsPending && !requestsError"),
  true,
);
check(
  "send-back is gated on the request list actually being known",
  rosterPanel.includes("canSendBack && requestsKnown && pending.length === 0"),
  true,
);
check(
  "account-type correction is gated on the same known state",
  rosterPanel.includes("canCorrect && requestsKnown"),
  true,
);
check(
  "a failed request load renders an error with retry, not an empty card",
  rosterPanel.includes("if (requestsError)") &&
    rosterPanel.includes("<InlineError") &&
    rosterPanel.includes("refetchRequests()"),
  true,
);
check(
  "a loading request list renders a skeleton rather than popping in",
  rosterPanel.includes("if (requestsPending)") && rosterPanel.includes("<Skeleton"),
  true,
);
check(
  "the early return only fires once the request list is known",
  rosterPanel.includes("if (requestsKnown && !canSendBack && !canCorrect"),
  true,
);
check(
  "the roster panel is not rendered while assignments are loading or errored",
  adminCourtAssignmentsPage.includes("!assignmentsPending") &&
    adminCourtAssignmentsPage.includes("!clerkAssignmentsPending") &&
    adminCourtAssignmentsPage.includes("!assignmentsError") &&
    adminCourtAssignmentsPage.includes("!clerkAssignmentsError"),
  true,
);

// --- dialog accessibility ---------------------------------------------------
// Radix renders DialogDescription as a real <p>. A <textarea> inside <p> is
// invalid nesting: the browser closes the paragraph early, so the element
// aria-describedby points at ends up empty and the dialog is announced with no
// description. The reason field must be a sibling of the header, not part of
// the description.

// Matches the IMPORT, not any mention: the ReasonDialog doc comment names
// AlertDialog to explain why it is deliberately not used here.
check(
  "the reason dialog no longer routes a Textarea through AlertDialog's description",
  /import \{[^}]*AlertDialog[^}]*\} from/.test(rosterPanel),
  false,
);
check(
  "the reason dialog's description is plain phrasing content",
  /description=\{?["`]/.test(rosterPanel) || rosterPanel.includes("description: string"),
  true,
);
check(
  "the reason Textarea sits outside DialogDescription",
  /<DialogDescription>\{description\}<\/DialogDescription>/.test(rosterPanel) &&
    rosterPanel.indexOf("</DialogHeader>") < rosterPanel.indexOf("<Textarea"),
  true,
);
check(
  "the reason field is labelled rather than placeholder-only",
  rosterPanel.includes("<Label htmlFor={reasonId}>") && rosterPanel.includes("id={reasonId}"),
  true,
);
check(
  "confirm still requires a typed reason on all three dialogs",
  (rosterPanel.match(/confirmDisabled=\{!\w+Reason\.trim\(\)/g) ?? []).length,
  3,
);

// --- send-back uses the atomic RPC -----------------------------------------
// return_unassigned_magistrate_to_requester() already rejects every pending
// row for the profile and returns the count, and it notifies BEFORE rejecting
// so the per-row trigger is deduped. The old client-side loop rejected rows one
// at a time, so a failure partway left some closed and some open with no notice.

check(
  "send-back calls the atomic RPC",
  requestsHook.includes('supabase.rpc("return_unassigned_magistrate_to_requester"'),
  true,
);
check(
  "the per-row client-side reject loop is gone",
  requestsHook.includes("rejectPendingRequestsForProfile"),
  false,
);
check(
  "send-back no longer rejects requests one at a time from the client",
  /for \(const row of rows\)/.test(requestsHook),
  false,
);

// --- 0142 row locking -------------------------------------------------------
// Both recovery RPCs check magistrate_courts/clerk_courts for emptiness and
// then write. Without a lock two administrators can both pass the same check.
// decide_magistrate_court_request() (0107) already established `for update`.

check(
  "0142 locks the profiles row in both recovery RPCs",
  sql0142.includes("return_unassigned_magistrate_to_requester") &&
    sql0142.includes("correct_unassigned_account_type") &&
    sql0142.includes("for update"),
  true,
);
check(
  "0142 takes the lock on the same select that reads the role",
  sql0142.includes("where id = p_profile_id\\n  for update;"),
  true,
);
check(
  "0142 asserts the statement it replaces appears exactly once",
  sql0142.includes("found % -- aborting") && sql0142.includes("v_hits <> 1"),
  true,
);
check(
  "0142 verifies the lock landed rather than assuming",
  sql0142.includes("still not locking the profiles row"),
  true,
);
check(
  "0142 records that the decide-approval race is NOT closed by this alone",
  sql0142.includes("does NOT close the race") && sql0142.includes("ABBA deadlock"),
  true,
);

check(
  "rejected court is available to request again",
  [...clerkCourtsUnavailableForNewRequest(
    [
      { court_id: "acquero", status: "rejected" },
      { court_id: "pending-court", status: "pending" },
    ],
    ["sitting-court"],
  )].sort(),
  ["pending-court", "sitting-court"].sort(),
);
check(
  "cancelled court is available to request again",
  [...clerkCourtsUnavailableForNewRequest([{ court_id: "acquero", status: "cancelled" }])].length,
  0,
);
check(
  "approved court with no active sitting is available after revoke",
  [...clerkCourtsUnavailableForNewRequest([{ court_id: "acquero", status: "approved" }])].length,
  0,
);
check("assignment type labels use Primary not regular", ASSIGNMENT_TYPE_LABEL.regular, "Primary");

check(
  "0144 unique primary may review clerks while covering sits",
  sql0144.includes("mc.assignment_type = 'regular'") &&
    sql0144.includes("and mc3.assignment_type = 'regular'") &&
    sql0144.includes("create or replace function public.can_manage_clerk_access") &&
    sql0144.includes("create or replace function public.court_has_no_clerk_approver"),
  true,
);
check(
  "clerk picker uses the unavailable-court helper, not every historical court",
  clerkAccessPage.includes("clerkCourtsUnavailableForNewRequest") &&
    !clerkAccessPage.includes("requestedCourtIds"),
  true,
);
check(
  "roster Assign passes an explicit assignment type",
  adminCourtAssignmentsPage.includes("assignmentType") &&
    adminCourtAssignmentsPage.includes("createAssignment.mutate") &&
    adminCourtAssignmentsPage.includes("Acting and Relief"),
  true,
);
check(
  "clerk notify treats unique primary as authorized even with covering",
  clerkNotify.includes("assignment_type") &&
    clerkNotify.includes('a.assignment_type === "regular"') &&
    clerkNotify.includes("regularCount === 1"),
  true,
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
