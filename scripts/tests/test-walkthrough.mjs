import {
  shouldAutoStartWalkthrough,
  walkthroughRecordAfterAutoStart,
  walkthroughRecordAfterComplete,
  walkthroughRecordForPending,
  walkthroughStepsFor,
} from "../../src/lib/walkthrough.ts";

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

check("pending magistrate has no tour", walkthroughStepsFor("magistrate", true).length, 0);
check("clerk tour is short", walkthroughStepsFor("clerk", false).length, 2);
check("magistrate tour is at most 7 steps", walkthroughStepsFor("magistrate", false).length <= 7, true);
check("admin tour is at most 7 steps", walkthroughStepsFor("admin", false).length <= 7, true);
check(
  "admin more-step mentions Administration",
  walkthroughStepsFor("admin", false).some((s) => s.body.includes("Administration")),
  true,
);

check(
  "pending magistrate does not auto-start",
  shouldAutoStartWalkthrough({
    role: "magistrate",
    isPendingMagistrate: true,
    record: { version: 1, awaitingAssignment: true },
  }),
  false,
);
check(
  "assigned magistrate auto-starts after waiting without a court",
  shouldAutoStartWalkthrough({
    role: "magistrate",
    isPendingMagistrate: false,
    record: { version: 1, awaitingAssignment: true },
  }),
  true,
);
check(
  "seated magistrate with no pending record never auto-starts",
  shouldAutoStartWalkthrough({
    role: "magistrate",
    isPendingMagistrate: false,
    record: null,
  }),
  false,
);
check(
  "completed tour never auto-starts again",
  shouldAutoStartWalkthrough({
    role: "magistrate",
    isPendingMagistrate: false,
    record: { version: 1, awaitingAssignment: true, completedAt: "2026-09-02T00:00:00.000Z" },
  }),
  false,
);
check(
  "prior auto-start never repeats in a later session",
  shouldAutoStartWalkthrough({
    role: "magistrate",
    isPendingMagistrate: false,
    record: { version: 1, autoStartedAt: "2026-09-02T00:00:00.000Z" },
  }),
  false,
);
check(
  "same-tab remount can finish showing the offer",
  shouldAutoStartWalkthrough({
    role: "magistrate",
    isPendingMagistrate: false,
    record: { version: 1, autoStartedAt: "2026-09-02T00:00:00.000Z" },
    sessionAutoPlay: true,
  }),
  true,
);
check(
  "clerk never auto-starts",
  shouldAutoStartWalkthrough({
    role: "clerk",
    isPendingMagistrate: false,
    record: { version: 1, awaitingAssignment: true },
  }),
  false,
);
check(
  "admin never auto-starts",
  shouldAutoStartWalkthrough({
    role: "admin",
    isPendingMagistrate: false,
    record: { version: 1, awaitingAssignment: true },
  }),
  false,
);

check(
  "pending visit marks awaiting assignment",
  walkthroughRecordForPending(null),
  { version: 1, awaitingAssignment: true },
);
check(
  "pending visit does not revive a finished tour",
  walkthroughRecordForPending({ version: 1, completedAt: "2026-09-02T00:00:00.000Z" }),
  { version: 1, completedAt: "2026-09-02T00:00:00.000Z" },
);
check(
  "auto-start clears awaiting and stamps once",
  walkthroughRecordAfterAutoStart({ version: 1, awaitingAssignment: true }, "2026-09-02T12:00:00.000Z"),
  { version: 1, awaitingAssignment: false, autoStartedAt: "2026-09-02T12:00:00.000Z" },
);
check(
  "finish keeps the auto-start stamp",
  walkthroughRecordAfterComplete(
    { version: 1, awaitingAssignment: false, autoStartedAt: "2026-09-02T12:00:00.000Z" },
    "2026-09-02T12:05:00.000Z",
  ),
  {
    version: 1,
    completedAt: "2026-09-02T12:05:00.000Z",
    autoStartedAt: "2026-09-02T12:00:00.000Z",
    awaitingAssignment: false,
  },
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
