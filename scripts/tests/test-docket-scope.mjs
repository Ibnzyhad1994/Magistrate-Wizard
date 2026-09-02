import { resolveDocketScope, docketScopeTitle, ALL_COURTS_PARAM } from "../../src/lib/docket-scope.ts";

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

const VIGILANCE = "vigilance-id";
const KAMARANG = "kamarang-id";
const OTHER = "unauthorized-court-id";

// --- loading -----------------------------------------------------------

check(
  "still loading while myCourtIds is undefined",
  resolveDocketScope({ requestedCourtId: null, myCourtIds: undefined, rememberedCourtId: null }),
  { status: "loading" },
);

// --- multi-court user, no ?court= param ---------------------------------

check(
  "multi-court, no param, no remembered scope -> All My Courts (no redirect)",
  resolveDocketScope({ requestedCourtId: null, myCourtIds: [VIGILANCE, KAMARANG], rememberedCourtId: null }),
  { status: "resolved", courtId: null },
);

check(
  "multi-court, no param, valid remembered scope -> redirect to it",
  resolveDocketScope({ requestedCourtId: null, myCourtIds: [VIGILANCE, KAMARANG], rememberedCourtId: KAMARANG }),
  { status: "redirect", courtId: KAMARANG },
);

check(
  "multi-court, no param, remembered scope no longer authorized -> All My Courts, not the stale court",
  resolveDocketScope({ requestedCourtId: null, myCourtIds: [VIGILANCE, KAMARANG], rememberedCourtId: OTHER }),
  { status: "resolved", courtId: null },
);

// --- single-court user ---------------------------------------------------

check(
  "single-court, no param -> redirect straight to that court",
  resolveDocketScope({ requestedCourtId: null, myCourtIds: [VIGILANCE], rememberedCourtId: null }),
  { status: "redirect", courtId: VIGILANCE },
);

check(
  "single-court, explicit ?court=all-like request for an unauthorized court -> redirect to the one authorized court, never All-My-Courts-by-accident nor the unauthorized one",
  resolveDocketScope({ requestedCourtId: OTHER, myCourtIds: [VIGILANCE], rememberedCourtId: null }),
  { status: "redirect", courtId: VIGILANCE },
);

// --- explicit ?court= param ------------------------------------------------

check(
  "explicit param for an authorized court -> resolved directly, no redirect",
  resolveDocketScope({ requestedCourtId: VIGILANCE, myCourtIds: [VIGILANCE, KAMARANG], rememberedCourtId: null }),
  { status: "resolved", courtId: VIGILANCE },
);

check(
  "explicit param for a court the user is NOT authorized for -> redirect to All My Courts, never silently applied",
  resolveDocketScope({ requestedCourtId: OTHER, myCourtIds: [VIGILANCE, KAMARANG], rememberedCourtId: null }),
  { status: "redirect", courtId: null },
);

check(
  "explicit param for a REVOKED court (myCourtIds no longer includes it) -> redirect away immediately",
  resolveDocketScope({ requestedCourtId: KAMARANG, myCourtIds: [VIGILANCE], rememberedCourtId: KAMARANG }),
  { status: "redirect", courtId: VIGILANCE },
);

check(
  "zero authorized courts, no param -> All My Courts (an empty combined view, never a crash or an arbitrary court)",
  resolveDocketScope({ requestedCourtId: null, myCourtIds: [], rememberedCourtId: null }),
  { status: "resolved", courtId: null },
);

// --- explicit "all" sentinel (the court-scope selector's own "All My
// Courts" choice) -- must always win, even over a still-remembered
// specific court, since it is a deliberate choice this turn, not an
// unopinionated bare URL. -----------------------------------------------

check(
  "explicit ?court=all -> resolved to All My Courts directly, no redirect",
  resolveDocketScope({ requestedCourtId: ALL_COURTS_PARAM, myCourtIds: [VIGILANCE, KAMARANG], rememberedCourtId: null }),
  { status: "resolved", courtId: null },
);

check(
  "explicit ?court=all overrides a still-remembered specific court (the bug this sentinel exists to prevent)",
  resolveDocketScope({ requestedCourtId: ALL_COURTS_PARAM, myCourtIds: [VIGILANCE, KAMARANG], rememberedCourtId: KAMARANG }),
  { status: "resolved", courtId: null },
);

check(
  "explicit ?court=all for a single-court user still resolves to All My Courts (their one court, trivially) rather than being treated as an unauthorized-court request",
  resolveDocketScope({ requestedCourtId: ALL_COURTS_PARAM, myCourtIds: [VIGILANCE], rememberedCourtId: null }),
  { status: "resolved", courtId: null },
);

// --- titles --------------------------------------------------------------

check("title for All My Courts", docketScopeTitle(null), "Docket: All My Courts");
check("title for a specific court", docketScopeTitle("Vigilance Magistrates' Court 1"), "Docket: Vigilance Magistrates' Court 1");

if (failures > 0) {
  console.log(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log("\nAll docket-scope tests passed.");
