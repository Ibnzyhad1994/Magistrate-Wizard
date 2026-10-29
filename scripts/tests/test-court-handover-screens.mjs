/**
 * Court hand-over screens (BE-26): the pre-flight shape the relinquish
 * dialog relies on, what each viewer is shown, and the refusals in the
 * screen's words. The RPCs themselves are covered live by
 * test-court-handover.mjs; this checks the client side of the contract.
 *
 *   npm run test:court-handover-screens
 */
import { readFileSync } from "node:fs";
import {
  TRANSFER_REASON_MAX,
  judgmentLabel,
  judgmentTransferSchema,
  matterLabel,
  pinFate,
  pinsToUnlink,
  preflightErrorMessage,
  preflightRefused,
  relinquishPreflightSchema,
  transferErrorMessage,
  transferReasonProblem,
} from "@/lib/court-handover";
import { checkRpc } from "@/lib/rpc-results";

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

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
// The pre-flight as the backend returns it (0220). `withNames` is the
// magistrate's view; an administrator gets no case numbers or titles.
const preflight = (withNames) => ({
  assignment_id: id(1),
  profile_id: id(2),
  court_id: id(3),
  court_name: "Riverside Magistrates' Court",
  ended: false,
  part_heard_unretained_count: 2,
  pinned_judgment_count: 3,
  pins_to_unlink_count: 1,
  part_heard_unretained: [
    {
      docket_matter_id: id(10),
      status: "active",
      last_heard_on: "2026-10-21",
      ...(withNames
        ? { case_number: "RMC-CR-2026-0254", matter_title: "Police v. B. Fictional" }
        : {}),
    },
    {
      docket_matter_id: id(11),
      status: "stayed",
      last_heard_on: "2026-10-02",
      ...(withNames
        ? { case_number: "RMC-CR-2026-0119", matter_title: "Police v. E. Invented" }
        : {}),
    },
  ],
  pinned_judgments: [
    { n: 20, discoverable: false, shared: false, unlink: true, title: "Ruling on the submission" },
    { n: 21, discoverable: true, shared: false, unlink: false, title: "Ruling on bail" },
    { n: 22, discoverable: false, shared: true, unlink: false, title: "Ruling on disclosure" },
  ].map((pin) => ({
    pin_id: id(pin.n),
    judgment_id: id(pin.n + 100),
    docket_matter_id: id(10),
    pinned_at: "2026-09-14T10:20:00Z",
    judgment_status: "final",
    is_discoverable: pin.discoverable,
    shared: pin.shared,
    will_unlink: pin.unlink,
    ...(withNames ? { judgment_title: pin.title } : {}),
  })),
});

// --- the shape both viewers get passes the boundary check -------------------

const magistrate = preflight(true);
const admin = preflight(false);
check(
  "the magistrate's pre-flight passes the boundary check",
  relinquishPreflightSchema.safeParse(magistrate).success,
  true,
);
check(
  "the administrator's pre-flight (no names) passes too",
  relinquishPreflightSchema.safeParse(admin).success,
  true,
);
check(
  "relinquish_preflight is a registered checked RPC",
  (() => {
    try {
      checkRpc(
        "relinquish_preflight",
        { ...magistrate, pinned_judgments: "oops" },
        { strict: true },
      );
      return false;
    } catch {
      return true;
    }
  })(),
  true,
);

// --- what each viewer is shown ------------------------------------------------

check(
  "the magistrate sees each part-heard matter by case number and title",
  magistrate.part_heard_unretained.map(matterLabel),
  ["RMC-CR-2026-0254 · Police v. B. Fictional", "RMC-CR-2026-0119 · Police v. E. Invented"],
);
check(
  "an administrator sees a matter by a short id, never a name",
  admin.part_heard_unretained.map(matterLabel),
  ["Matter 00000000", "Matter 00000000"],
);
check(
  "an administrator sees a judgment by a short id, never a title",
  admin.pinned_judgments.map(judgmentLabel).every((label) => label.startsWith("Judgment ")),
  true,
);
check(
  "only pins flagged will_unlink are listed as going",
  pinsToUnlink(magistrate).map((p) => p.pin_id),
  [id(20)],
);
check("each pin says why it stays or that it goes", magistrate.pinned_judgments.map(pinFate), [
  "Link removed",
  "Stays: discoverable",
  "Stays: shared",
]);

// --- refusals -----------------------------------------------------------------

check(
  "42501 and P0002 are refusals in the dialog's words",
  [
    preflightErrorMessage({ code: "42501" }) !== null,
    preflightErrorMessage({ code: "P0002" }) !== null,
  ],
  [true, true],
);
check(
  "any other failure falls back to the shared message",
  preflightErrorMessage({ code: "08006" }),
  null,
);
check(
  "a refusal blocks the confirm; a network failure does not (relinquish is never blocked)",
  [
    preflightRefused({ isError: true, error: { code: "P0002" } }),
    preflightRefused({ isError: true, error: new Error("Failed to fetch") }),
    preflightRefused({ isError: false, error: null }),
  ],
  [true, false, false],
);

// --- the screens show only what the backend gave them -------------------------

const summary = readFileSync("src/components/court-handover/relinquish-preflight.tsx", "utf8");
check(
  "the pre-flight summary reads no matter or judgment table itself",
  /supabase|\.from\(/.test(summary),
  false,
);
check(
  "only the magistrate's own view offers Retain",
  /mode === "self" && \(\s*<Button/.test(summary),
  true,
);

// --- the administrator's judgment transfer -----------------------------------

check(
  "a transfer reason is required and at most 500 characters",
  [
    transferReasonProblem("   "),
    transferReasonProblem("x".repeat(TRANSFER_REASON_MAX)),
    transferReasonProblem("x".repeat(TRANSFER_REASON_MAX + 1)),
  ],
  ["missing", null, "too-long"],
);
check(
  "each transfer refusal has its own sentence",
  ["42501", "22023", "P0002", "P0001"].map((code) => transferErrorMessage({ code }) !== null),
  [true, true, true, true],
);
check(
  "the target-not-at-court refusal names the court, not a permission problem",
  /sit at this court/.test(transferErrorMessage({ code: "P0001" }) ?? ""),
  true,
);
const transferResult = {
  transfer_id: id(30),
  judgment_id: id(120),
  from_owner_id: id(2),
  to_owner_id: id(4),
  original_author_id: id(2),
  court_id: id(3),
  transferred_at: "2026-10-29T15:00:00Z",
};
check(
  "the transfer result is ids and a time, nothing more",
  Object.keys(judgmentTransferSchema.shape).sort(),
  Object.keys(transferResult).sort(),
);
check(
  "transfer_judgment_ownership is a registered checked RPC",
  (() => {
    try {
      checkRpc(
        "transfer_judgment_ownership",
        { ...transferResult, to_owner_id: 7 },
        { strict: true },
      );
      return false;
    } catch {
      return true;
    }
  })(),
  true,
);
const transferDialog = readFileSync("src/pages/admin/transfer-judgment-dialog.tsx", "utf8");
check(
  "the transfer picks its new owner from the court's bench, never the departing magistrate",
  [
    /useCourtBench\(/.test(transferDialog),
    /profileId !== target\?\.fromProfileId/.test(transferDialog),
  ],
  [true, true],
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
