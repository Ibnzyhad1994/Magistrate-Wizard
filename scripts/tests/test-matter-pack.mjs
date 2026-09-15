/**
 * Matter pack sanitizer — no live database.
 *
 *   npm run test:matter-pack
 */
import {
  duplicateCaseNumbers,
  matterIsExportable,
  parseMatterPack,
  projectMatterInsert,
  sanitizeMatterForPack,
  stripForbiddenKeys,
  MATTER_PACK_FORMAT,
  MATTER_PACK_VERSION,
} from "../../src/lib/matter-pack.ts";

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
  "sitting court may export",
  matterIsExportable({
    matterId: "m1",
    courtId: "c1",
    sittingCourtIds: ["c1"],
    retainedMatterIds: [],
  }),
  true,
);
check(
  "retained assignment may export",
  matterIsExportable({
    matterId: "m1",
    courtId: "c-other",
    sittingCourtIds: ["c1"],
    retainedMatterIds: ["m1"],
  }),
  true,
);
check(
  "view-share-only court is not exportable",
  matterIsExportable({
    matterId: "m1",
    courtId: "c-foreign",
    sittingCourtIds: ["c1"],
    retainedMatterIds: [],
  }),
  false,
);

const stripped = stripForbiddenKeys({
  id: "uuid",
  owner_id: "someone-else",
  court_id: "foreign-court",
  created_by: "other",
  contact_info: "hidden",
  case_number: "2026/1",
  matter_title: "R v Test",
});
check("strip drops foreign ownership keys", "id" in stripped || "owner_id" in stripped || "court_id" in stripped, false);
check("strip keeps identity fields", stripped.case_number, "2026/1");

const hostile = sanitizeMatterForPack({
  id: "keep-me",
  owner_id: "attacker",
  court_id: "attacker-court",
  case_number: "2026/9",
  matter_title: "Imported",
  parties: [
    { full_name: "Jane", role: "Accused", contact_info: "secret", identification_photo_path: "x.png" },
    { full_name: "", role: "skip" },
  ],
  events: [
    { id: "e1", scheduled_date: "2026-09-01", presiding_magistrate_id: "mag-2", event_status: "scheduled" },
    { scheduled_date: "not-a-date" },
  ],
});
check("sanitized matter has no id", hostile && !("id" in hostile), true);
check("party contact info never survives", hostile?.parties[0] && !("contact_info" in hostile.parties[0]), true);
check("invalid events are dropped", hostile?.events.length, 1);
check("event magistrate id is stripped", hostile?.events[0] && !("presiding_magistrate_id" in hostile.events[0]), true);

const parsedUnknown = parseMatterPack({ format: "other", version: 1, matters: [{}] });
check("unknown format fails closed", parsedUnknown.ok, false);

const parsed = parseMatterPack({
  format: MATTER_PACK_FORMAT,
  version: MATTER_PACK_VERSION,
  exported_at: "2026-09-15T00:00:00Z",
  matters: [
    {
      case_number: "2026/9",
      matter_title: "Imported",
      owner_id: "attacker",
      court_id: "attacker-court",
    },
  ],
});
check("known pack parses", parsed.ok, true);
if (parsed.ok) {
  const insert = projectMatterInsert(parsed.pack.matters[0], "court-mine", "district-mine");
  check("import rebinds court", insert.court_id, "court-mine");
  check("import never keeps pack court", insert.court_id === "attacker-court", false);
  check("import never carries owner_id", "owner_id" in insert, false);
}

check(
  "duplicate case numbers are court-scoped",
  duplicateCaseNumbers(
    [{ case_number: "2026/1" }, { case_number: "2026/2" }],
    [
      { case_number: "2026/1", court_id: "court-a" },
      { case_number: "2026/2", court_id: "court-b" },
    ],
    "court-a",
  ),
  ["2026/1"],
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
