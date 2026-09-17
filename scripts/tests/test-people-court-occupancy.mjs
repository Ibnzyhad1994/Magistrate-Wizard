import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  occupiedExceptionSubmitMessage,
  occupiedResolutionHint,
  occupiedResolutionLabel,
  pendingRequestOccupiesCourtSlot,
  primaryAssignmentOccupiesCourtSlot,
  requestNeedsOccupiedResolution,
} from "@/lib/occupied-court-exception";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql0152 = readFileSync(
  join(__dirname, "../../supabase/migrations/0152_people_court_occupancy_and_exceptions.sql"),
  "utf8",
);
const registerPage = readFileSync(
  join(__dirname, "../../src/pages/auth/register-page.tsx"),
  "utf8",
);
const peoplePage = readFileSync(
  join(__dirname, "../../src/pages/admin/people-admin-page.tsx"),
  "utf8",
);
const peopleSheet = readFileSync(
  join(__dirname, "../../src/pages/admin/people-court-sheet.tsx"),
  "utf8",
);
const reviewPanel = readFileSync(
  join(__dirname, "../../src/pages/admin/magistrate-court-request-review-panel.tsx"),
  "utf8",
);
const selfService = readFileSync(
  join(__dirname, "../../src/pages/court-assignments/court-assignments-page.tsx"),
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

check("pending requests never occupy a court", pendingRequestOccupiesCourtSlot("pending"), false);
check(
  "never-logged-in regular does not occupy",
  primaryAssignmentOccupiesCourtSlot({
    assignmentType: "regular",
    endedAt: null,
    lastLoginAt: null,
  }),
  false,
);
check(
  "signed-in regular occupies",
  primaryAssignmentOccupiesCourtSlot({
    assignmentType: "regular",
    endedAt: null,
    lastLoginAt: "2026-09-01T12:00:00Z",
  }),
  true,
);
check(
  "acting sitting does not occupy the primary slot",
  primaryAssignmentOccupiesCourtSlot({
    assignmentType: "acting",
    endedAt: null,
    lastLoginAt: "2026-09-01T12:00:00Z",
  }),
  false,
);
check(
  "ended regular does not occupy",
  primaryAssignmentOccupiesCourtSlot({
    assignmentType: "regular",
    endedAt: "2026-09-02T00:00:00Z",
    lastLoginAt: "2026-09-01T12:00:00Z",
  }),
  false,
);
check(
  "occupied-exception requests need an admin resolution",
  requestNeedsOccupiedResolution({ requestKind: "occupied_exception", courtIsOccupied: false }),
  true,
);
check(
  "ordinary request at a free court does not need resolution",
  requestNeedsOccupiedResolution({ requestKind: "ordinary", courtIsOccupied: false }),
  false,
);
check(
  "ordinary request at a court that became occupied needs resolution",
  requestNeedsOccupiedResolution({ requestKind: "ordinary", courtIsOccupied: true }),
  true,
);
check(
  "replace copy names the incumbent",
  occupiedResolutionLabel("replace").includes("Replace"),
  true,
);
check(
  "co-sit copy seats a second magistrate",
  occupiedResolutionLabel("co_sit").includes("second magistrate"),
  true,
);
check(
  "co-sit hint keeps the current primary",
  occupiedResolutionHint("co_sit").includes("acting"),
  true,
);
check(
  "occupied signup toast tells them an admin decides",
  occupiedExceptionSubmitMessage(true).includes("Special exception"),
  true,
);

check(
  "0152 occupies only after first sign-in",
  sql0152.includes("profile_has_completed_first_sign_in") &&
    sql0152.includes("occupies_primary_slot") &&
    sql0152.includes("login_success"),
  true,
);
check(
  "0152 occupancy backfill skips ended sittings and allows first-sign-in refresh",
  sql0152.includes("create or replace function public.protect_magistrate_court_history") &&
    sql0152.includes("refresh occupancy after first sign-in") &&
    sql0152.includes("where mc.assignment_type = 'regular' and mc.ended_at is null") &&
    sql0152.includes("disable trigger protect_magistrate_court_history_trigger"),
  true,
);
check(
  "0152 accepts occupied courts as occupied_exception",
  sql0152.includes("occupied_exception") &&
    sql0152.includes("p_occupied_resolution") &&
    sql0152.includes("co_sit"),
  true,
);
check(
  "0152 transfer and seat RPCs exist",
  sql0152.includes("admin_transfer_magistrate_court") &&
    sql0152.includes("admin_seat_magistrate_at_court"),
  true,
);
check(
  "0152 first sign-in yields if another occupying primary already sits",
  sql0152.includes("claim_primary_slot_on_first_sign_in") &&
    sql0152.includes("this court already has a signed-in primary magistrate"),
  true,
);
check(
  "signup no longer disables occupied courts",
  registerPage.includes("Occupied — exception") && !registerPage.includes("disabled={isAssigned}"),
  true,
);
check(
  "People tab can manage assign, transfer, and end",
  peoplePage.includes("PeopleCourtSheet") &&
    peopleSheet.includes("Transfer to another court") &&
    peopleSheet.includes("useTransferCourtAssignment"),
  true,
);
check(
  "People tab can end a clerk sitting",
  peopleSheet.includes("useRevokeClerkCourtAccess") && peopleSheet.includes("Clerk courts"),
  true,
);
check(
  "review panel asks replace vs co-sit",
  reviewPanel.includes("Special seating exception") && reviewPanel.includes("occupiedResolution"),
  true,
);
check(
  "self-service can request an occupied court",
  selfService.includes("Request exception") && selfService.includes('c.status === "assigned"'),
  true,
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
