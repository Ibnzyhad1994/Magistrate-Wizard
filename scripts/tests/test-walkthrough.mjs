import {
  docketMatterPathFromLocation,
  shouldAutoStartWalkthrough,
  visibleWalkthroughSteps,
  walkthroughRecordAfterAutoStart,
  walkthroughRecordAfterComplete,
  walkthroughRecordForPending,
  walkthroughStepsFor,
} from "../../src/lib/walkthrough.ts";
import {
  NAV_ITEMS,
  navTourIdForHref,
  visibleNavItems,
} from "../../src/components/layout/nav-config.ts";

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

const clerk = walkthroughStepsFor("clerk", false);
const magistrate = walkthroughStepsFor("magistrate", false);
const admin = walkthroughStepsFor("admin", false);
const idsIn = (steps, chapter) =>
  steps.filter((s) => s.chapter === chapter).map((s) => s.id);

// --- role coverage ---------------------------------------------------------
// The rule the tour is built on: never point at something the role cannot
// reach. This is checked against nav-config itself rather than a copied
// list, so adding a `roles` restriction to a nav item fails here instead
// of silently leaving a step ringing empty space.

const navTourIdsFor = (role) =>
  new Set(
    visibleNavItems(NAV_ITEMS, role, false)
      .map((item) => navTourIdForHref(item.href))
      .filter(Boolean),
  );

for (const [role, steps] of [
  ["clerk", clerk],
  ["magistrate", magistrate],
  ["admin", admin],
]) {
  const reachable = navTourIdsFor(role);
  const unreachable = steps
    .filter((s) => s.navTarget && s.navTarget !== "nav-more")
    .filter((s) => !reachable.has(s.navTarget))
    .map((s) => `${s.id} -> ${s.navTarget}`);
  check(`every ${role} step points at a nav item that role can see`, unreachable, []);
}

check(
  "a clerk is never shown Callovers, Judgments, Case Law, or Search",
  clerk.filter((s) =>
    ["callovers", "judgments", "case-law", "legislation", "search"].includes(s.id),
  ),
  [],
);
check(
  "only a clerk is walked through their own court-access request page",
  {
    clerk: clerk.some((s) => s.id === "clerk-access"),
    magistrate: magistrate.some((s) => s.id === "clerk-access"),
  },
  { clerk: true, magistrate: false },
);
check(
  "only magistrates and admins are walked through the clerk-access review queue",
  {
    clerk: clerk.some((s) => s.id === "clerk-access-requests"),
    magistrate: magistrate.some((s) => s.id === "clerk-access-requests"),
    admin: admin.some((s) => s.id === "clerk-access-requests"),
  },
  { clerk: false, magistrate: true, admin: true },
);
check(
  "admin gets the magistrate tour plus Administration, not a separate one",
  admin.filter((s) => !magistrate.some((m) => m.id === s.id)).map((s) => s.id),
  ["legal-library", "people", "administration"],
);

// --- the shared board ------------------------------------------------------
// Clerks and magistrates work the same sheet, so the board steps must be
// the same steps, not two drifting copies.

const boardIds = ["board", "outcome", "next"];
check(
  "clerk and magistrate get identical board steps",
  boardIds.map((id) => JSON.stringify(clerk.find((s) => s.id === id))),
  boardIds.map((id) => JSON.stringify(magistrate.find((s) => s.id === id))),
);
check(
  "the board step teaches the not-found arraignment status",
  magistrate.find((s) => s.id === "board")?.body.includes("Not Found — To Be Summoned"),
  true,
);
check(
  "the outcome step names both values and what setting one does",
  (() => {
    const body = magistrate.find((s) => s.id === "outcome")?.body ?? "";
    return ["Dismissed", "Completed", "status"].every((word) => body.includes(word));
  })(),
  true,
);
check(
  "outcome falls back to the board when the column is off screen",
  {
    target: magistrate.find((s) => s.id === "outcome")?.target,
    fallback: magistrate.find((s) => s.id === "outcome")?.fallbackTarget,
  },
  { target: "docket-outcome", fallback: "docket-board" },
);

// --- chapter shape ---------------------------------------------------------

check("clerk sitting-day ids", idsIn(clerk, "sitting"), [
  "home",
  "docket",
  "new-matter",
  "board",
  "outcome",
  "next",
  "open-file",
  "chapter-rest",
]);
check("clerk rest-of-app ids", idsIn(clerk, "rest"), ["clerk-access", "notifications"]);
check("magistrate sitting-day ids", idsIn(magistrate, "sitting"), [
  "home",
  "docket",
  "board",
  "outcome",
  "next",
  "open-file",
  "hearing",
  "file",
  "chapter-rest",
]);
check("magistrate rest-of-app ids", idsIn(magistrate, "rest"), [
  "callovers",
  "calendar",
  "judgments",
  "case-law",
  "legislation",
  "bench-notes",
  "clerk-access-requests",
  "court-assignments",
  "search",
]);
check(
  "every role gets a chapter break it can stop at",
  [clerk, magistrate, admin].map((steps) => steps.find((s) => s.kind === "choice")?.id),
  ["chapter-rest", "chapter-rest", "chapter-rest"],
);
check(
  "file steps require a matter",
  magistrate.filter((s) => s.requiresMatter).map((s) => s.id),
  ["open-file", "hearing", "file"],
);
check(
  "empty docket sitting day skips the file",
  visibleWalkthroughSteps(magistrate, "sitting", false).map((s) => s.id),
  ["home", "docket", "board", "outcome", "next", "chapter-rest"],
);
check(
  "full sitting day keeps the file",
  visibleWalkthroughSteps(magistrate, "sitting", true).map((s) => s.id),
  idsIn(magistrate, "sitting"),
);
check(
  "a clerk's chapter break still offers something after it",
  visibleWalkthroughSteps(clerk, "rest", false).length > 0,
  true,
);
check(
  "rest steps are page spotlights, not control rings",
  [clerk, magistrate, admin].every((steps) =>
    steps.filter((s) => s.chapter === "rest").every((s) => s.kind === "page"),
  ),
  true,
);
check(
  "sitting-day control steps keep a ring",
  [clerk, magistrate, admin].every((steps) =>
    steps
      .filter((s) => s.chapter === "sitting" && s.kind !== "choice")
      .every((s) => s.kind !== "page"),
  ),
  true,
);
check(
  "every page step can fall back to the More menu",
  [clerk, magistrate, admin].every((steps) =>
    steps
      .filter((s) => s.kind === "page")
      .every((s) => s.fallbackTarget === "nav-more" || s.navTarget === "nav-more"),
  ),
  true,
);
check(
  "every step that is not the chapter break has somewhere to point",
  [clerk, magistrate, admin].every((steps) =>
    steps.filter((s) => s.kind !== "choice").every((s) => Boolean(s.target)),
  ),
  true,
);
check(
  "no role has a duplicate step id",
  [clerk, magistrate, admin].map((steps) => steps.length - new Set(steps.map((s) => s.id)).size),
  [0, 0, 0],
);
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
