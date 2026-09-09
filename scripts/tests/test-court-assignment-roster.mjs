import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canSendUnassignedMagistrateBack,
  pendingRequestsForProfile,
  requestsForProfile,
  waitingListRequestLabel,
} from "@/lib/court-assignment-roster";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(
  join(__dirname, "../../supabase/migrations/0135_roster_return_unassigned_magistrate.sql"),
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

check("migration adds court_request_decided", sql.includes("'court_request_decided'"), true);
check(
  "migration notifies the requester on reject/approve",
  sql.includes("after insert or update on public.magistrate_court_requests") &&
    sql.includes("Your court request was not approved"),
  true,
);
check(
  "migration adds the roster send-back RPC",
  sql.includes("return_unassigned_magistrate_to_requester") &&
    sql.includes("grant execute on function public.return_unassigned_magistrate_to_requester"),
  true,
);
check(
  "send-back rejects remaining pending rows",
  sql.includes("and status = 'pending'") && sql.includes("set status = 'rejected'"),
  true,
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
