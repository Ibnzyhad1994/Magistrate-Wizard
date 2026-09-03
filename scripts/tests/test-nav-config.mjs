// visibleNavItems(): role filtering (existing behavior) plus the new
// isPendingMagistrate lockdown -- a magistrate awaiting court approval
// must see nothing except items explicitly marked visibleWhilePending
// (only Court Assignments sets this), matching the route-level gate
// (requireApprovedMagistrateCourt, router.tsx) so the nav never dangles
// a link the router will just bounce the user back out of.

import { NAV_ITEMS, visibleNavItems } from "@/components/layout/nav-config";
import { ROUTES } from "@/routes/paths";

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

const items = [
  { label: "Dashboard", href: "/dashboard", icon: null },
  { label: "Docket", href: "/docket", icon: null },
  { label: "Court Assignments", href: "/court-assignments", icon: null, roles: ["magistrate", "admin"], visibleWhilePending: true },
  { label: "Case Law", href: "/case-law", icon: null, roles: ["magistrate", "admin"] },
  { label: "Manage Court Assignments", href: "/admin/court-assignments", icon: null, roles: ["admin"] },
];

check(
  "magistrate, not pending: sees everything role allows",
  visibleNavItems(items, "magistrate").map((i) => i.href),
  ["/dashboard", "/docket", "/court-assignments", "/case-law"],
);

check(
  "pending magistrate: sees only visibleWhilePending items",
  visibleNavItems(items, "magistrate", true).map((i) => i.href),
  ["/court-assignments"],
);

check(
  "pending flag is a no-op for admin (admin is never gated on magistrate-court approval)",
  visibleNavItems(items, "admin", true).map((i) => i.href),
  ["/dashboard", "/docket", "/court-assignments", "/case-law", "/admin/court-assignments"],
);

check(
  "pending flag is a no-op for clerk (clerk has no such item to lose anyway)",
  visibleNavItems(items, "clerk", true).map((i) => i.href),
  ["/dashboard", "/docket"],
);

check(
  "notifications is a workbench nav item",
  NAV_ITEMS.some((item) => item.href === ROUTES.notifications && item.group === "workbench"),
  true,
);
check(
  "operations is an admin nav item",
  NAV_ITEMS.some((item) => item.href === ROUTES.adminOperations && item.roles?.includes("admin")),
  true,
);

check(
  "isPendingMagistrate undefined (role check not yet resolved) behaves like false -- no lockdown until explicitly true",
  visibleNavItems(items, "magistrate").map((i) => i.href),
  ["/dashboard", "/docket", "/court-assignments", "/case-law"],
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
