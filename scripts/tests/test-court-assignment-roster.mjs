import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canCorrectUnassignedAccountType,
  canSendUnassignedMagistrateBack,
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

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
