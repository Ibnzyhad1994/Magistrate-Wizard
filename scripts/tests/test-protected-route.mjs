// ProtectedRoute gate: admin deep-links must wait for profile, not bounce
// to /unauthorized while session is restored.

import { resolveProtectedRouteGate } from "@/lib/protected-route-gate";

let failures = 0;
function check(label, actual, expected) {
  const pass = actual === expected;
  console.log(`${pass ? "PASS" : "FAIL"} — ${label}`);
  if (!pass) {
    console.log("  expected:", expected);
    console.log("  actual:  ", actual);
    failures += 1;
  }
}

check("loading status shows loader", resolveProtectedRouteGate({ status: "loading", profile: null }), "loading");
check("unauthenticated goes to login", resolveProtectedRouteGate({ status: "unauthenticated", profile: null }), "login");
check(
  "authenticated admin deep-link waits for profile",
  resolveProtectedRouteGate({
    status: "authenticated",
    profile: null,
    allowedRoles: ["admin"],
  }),
  "loading",
);
check(
  "authenticated magistrate is unauthorized on admin routes",
  resolveProtectedRouteGate({
    status: "authenticated",
    profile: { role: "magistrate" },
    allowedRoles: ["admin"],
  }),
  "unauthorized",
);
check(
  "authenticated admin is ok",
  resolveProtectedRouteGate({
    status: "authenticated",
    profile: { role: "admin" },
    allowedRoles: ["admin"],
  }),
  "ok",
);
check(
  "authenticated without role restriction is ok even before profile",
  resolveProtectedRouteGate({ status: "authenticated", profile: null }),
  "ok",
);

// --- Docket route regression: an admin who also holds an active
// magistrate_courts assignment must reach Docket exactly like a
// magistrate does. router.tsx deliberately passes NO allowedRoles for
// the Docket route group (whole-court access is governed by court
// ASSIGNMENT, not platform role) -- these cases pin that down so an
// allowedRoles allowlist can never quietly creep back onto that route
// and exclude 'admin' again. ---
check(
  "Docket route config (no allowedRoles): admin reaches the route",
  resolveProtectedRouteGate({ status: "authenticated", profile: { role: "admin" } }),
  "ok",
);
check(
  "Docket route config (no allowedRoles): magistrate reaches the route",
  resolveProtectedRouteGate({ status: "authenticated", profile: { role: "magistrate" } }),
  "ok",
);
check(
  "the regression this guards against: an admin WOULD be wrongly blocked if the Docket route ever added allowedRoles=['magistrate','clerk'] again",
  resolveProtectedRouteGate({
    status: "authenticated",
    profile: { role: "admin" },
    allowedRoles: ["magistrate", "clerk"],
  }),
  "unauthorized",
);

// --- requireApprovedClerkCourt: only meaningful for role='clerk', a
// no-op for every other role (magistrate/admin pass regardless). ---
check(
  "clerk with requireApprovedClerkCourt and no approved court yet -> pending-clerk experience, not /unauthorized",
  resolveProtectedRouteGate({
    status: "authenticated",
    profile: { role: "clerk" },
    requireApprovedClerkCourt: true,
    hasApprovedClerkCourt: false,
  }),
  "pending-clerk",
);
check(
  "clerk with requireApprovedClerkCourt still loading the approval check -> loading, never a flash of Docket content",
  resolveProtectedRouteGate({
    status: "authenticated",
    profile: { role: "clerk" },
    requireApprovedClerkCourt: true,
    hasApprovedClerkCourt: undefined,
  }),
  "loading",
);
check(
  "approved clerk with requireApprovedClerkCourt -> ok",
  resolveProtectedRouteGate({
    status: "authenticated",
    profile: { role: "clerk" },
    requireApprovedClerkCourt: true,
    hasApprovedClerkCourt: true,
  }),
  "ok",
);
check(
  "requireApprovedClerkCourt is a no-op for admin (Docket route) -- never gated on clerk-court approval",
  resolveProtectedRouteGate({
    status: "authenticated",
    profile: { role: "admin" },
    requireApprovedClerkCourt: true,
    hasApprovedClerkCourt: false,
  }),
  "ok",
);
check(
  "requireApprovedClerkCourt is a no-op for magistrate (Docket route) -- never gated on clerk-court approval",
  resolveProtectedRouteGate({
    status: "authenticated",
    profile: { role: "magistrate" },
    requireApprovedClerkCourt: true,
    hasApprovedClerkCourt: false,
  }),
  "ok",
);

// --- requireApprovedMagistrateCourt: only meaningful for role='magistrate',
// a no-op for every other role (clerk/admin pass regardless -- in
// particular an admin who is also a sitting magistrate is never gated on
// this, since their platform access is role-based, not court-based). ---
check(
  "magistrate with requireApprovedMagistrateCourt and no approved court yet -> pending-magistrate experience, not /unauthorized",
  resolveProtectedRouteGate({
    status: "authenticated",
    profile: { role: "magistrate" },
    requireApprovedMagistrateCourt: true,
    hasApprovedMagistrateCourt: false,
  }),
  "pending-magistrate",
);
check(
  "magistrate with requireApprovedMagistrateCourt still loading the approval check -> loading, never a flash of full content",
  resolveProtectedRouteGate({
    status: "authenticated",
    profile: { role: "magistrate" },
    requireApprovedMagistrateCourt: true,
    hasApprovedMagistrateCourt: undefined,
  }),
  "loading",
);
check(
  "approved magistrate with requireApprovedMagistrateCourt -> ok",
  resolveProtectedRouteGate({
    status: "authenticated",
    profile: { role: "magistrate" },
    requireApprovedMagistrateCourt: true,
    hasApprovedMagistrateCourt: true,
  }),
  "ok",
);
check(
  "requireApprovedMagistrateCourt is a no-op for admin -- never gated on magistrate-court approval, even if they hold none",
  resolveProtectedRouteGate({
    status: "authenticated",
    profile: { role: "admin" },
    requireApprovedMagistrateCourt: true,
    hasApprovedMagistrateCourt: false,
  }),
  "ok",
);
check(
  "requireApprovedMagistrateCourt is a no-op for clerk -- never gated on magistrate-court approval",
  resolveProtectedRouteGate({
    status: "authenticated",
    profile: { role: "clerk" },
    requireApprovedMagistrateCourt: true,
    hasApprovedMagistrateCourt: false,
  }),
  "ok",
);
check(
  "both requireApprovedClerkCourt and requireApprovedMagistrateCourt on the same route (Docket): pending magistrate -> pending-magistrate, not blocked by the unrelated clerk check",
  resolveProtectedRouteGate({
    status: "authenticated",
    profile: { role: "magistrate" },
    requireApprovedClerkCourt: true,
    hasApprovedClerkCourt: false,
    requireApprovedMagistrateCourt: true,
    hasApprovedMagistrateCourt: false,
  }),
  "pending-magistrate",
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
