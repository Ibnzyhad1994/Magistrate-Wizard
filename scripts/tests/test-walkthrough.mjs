import {
  docketMatterPathFromLocation,
  shouldAutoStartWalkthrough,
  visibleWalkthroughSteps,
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

const magistrate = walkthroughStepsFor("magistrate", false);
check(
  "magistrate sitting-day ids",
  magistrate.filter((s) => s.chapter === "sitting").map((s) => s.id),
  ["home", "docket", "board", "next", "open-file", "hearing", "file", "chapter-rest"],
);
check(
  "magistrate rest-of-app ids",
  magistrate.filter((s) => s.chapter === "rest").map((s) => s.id),
  ["calendar", "case-law", "legislation", "bench-notes", "search"],
);
check(
  "file steps require a matter",
  magistrate.filter((s) => s.requiresMatter).map((s) => s.id),
  ["open-file", "hearing", "file"],
);
check(
  "choice step sits at the chapter break",
  magistrate.find((s) => s.kind === "choice")?.id,
  "chapter-rest",
);
check(
  "empty docket sitting day skips the file",
  visibleWalkthroughSteps(magistrate, "sitting", false).map((s) => s.id),
  ["home", "docket", "board", "next", "chapter-rest"],
);
check(
  "board copy still names empty cells without asking to click the sample",
  magistrate.find((s) => s.id === "board")?.body,
  "Empty cells say + Set arraignment and the rest. On a real file, click a cell to record that stage.",
);
check(
  "full sitting day keeps the file",
  visibleWalkthroughSteps(magistrate, "sitting", true).map((s) => s.id),
  ["home", "docket", "board", "next", "open-file", "hearing", "file", "chapter-rest"],
);
check(
  "rest chapter is calendar through search",
  visibleWalkthroughSteps(magistrate, "rest", true).map((s) => s.id),
  ["calendar", "case-law", "legislation", "bench-notes", "search"],
);
check(
  "rest steps are page spotlights, not control rings",
  magistrate.filter((s) => s.chapter === "rest").every((s) => s.kind === "page"),
  true,
);
check(
  "calendar page lights Calendar in the nav",
  {
    nav: magistrate.find((s) => s.id === "calendar")?.navTarget,
    fallback: magistrate.find((s) => s.id === "calendar")?.fallbackTarget,
  },
  { nav: "nav-calendar", fallback: "nav-more" },
);
check(
  "case law page lights the Case Law nav link",
  magistrate.find((s) => s.id === "case-law")?.navTarget,
  "nav-case-law",
);
check(
  "legislation page lights the Legislation nav link",
  magistrate.find((s) => s.id === "legislation")?.navTarget,
  "nav-legislation",
);
check(
  "bench notes page lights Bench Notes in the nav",
  {
    nav: magistrate.find((s) => s.id === "bench-notes")?.navTarget,
    fallback: magistrate.find((s) => s.id === "bench-notes")?.fallbackTarget,
  },
  { nav: "nav-bench-notes", fallback: "nav-more" },
);
check(
  "search page lights the search control",
  {
    nav: magistrate.find((s) => s.id === "search")?.navTarget,
    fallback: magistrate.find((s) => s.id === "search")?.fallbackTarget,
  },
  { nav: "nav-search", fallback: "nav-more" },
);
check(
  "sitting-day control steps keep a ring",
  magistrate
    .filter((s) => s.chapter === "sitting" && s.kind !== "choice")
    .every((s) => s.kind !== "page"),
  true,
);
check(
  "clerk tour has no chapters",
  walkthroughStepsFor("clerk", false).every((s) => !s.chapter && s.kind !== "choice"),
  true,
);
check(
  "admin search mentions Administration",
  walkthroughStepsFor("admin", false).some((s) => s.id === "search" && s.body.includes("Administration")),
  true,
);
check("magistrate search does not mention Administration", magistrate.find((s) => s.id === "search")?.body.includes("Administration"), false);
check("docket list is not a matter path", docketMatterPathFromLocation("/docket"), null);
check("docket bin is not a matter path", docketMatterPathFromLocation("/docket/bin"), null);
check(
  "matter detail is a matter path",
  docketMatterPathFromLocation("/docket/89f8ff21-5769-4c32-adbf-045f190d6377"),
  "/docket/89f8ff21-5769-4c32-adbf-045f190d6377",
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
