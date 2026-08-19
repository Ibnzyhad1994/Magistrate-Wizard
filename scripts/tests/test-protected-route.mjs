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

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
