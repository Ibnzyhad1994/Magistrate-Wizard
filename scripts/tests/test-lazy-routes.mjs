// Regression: every page in src/routes/router.tsx must stay code-split.
// Pure text check — no bundler, no React. A single static
// `import XPage from "@/pages/..."` would pull that page (and whatever it
// drags in: TipTap, jsPDF, the admin consoles) back into the main chunk
// for every user, and nothing else in the build would fail.
//
// Run: node scripts/tests/test-lazy-routes.mjs

import { readFileSync } from "node:fs";

let failures = 0;
const check = (label, actual, expected) => {
  const pass = actual === expected;
  console.log(`${pass ? "PASS" : "FAIL"} - ${label}`);
  if (!pass) {
    console.log("  expected:", expected);
    console.log("  actual:  ", actual);
    failures += 1;
  }
};

const source = readFileSync("src/routes/router.tsx", "utf8");

// --- no static page imports -------------------------------------------------
const staticPageImports = [
  ...source.matchAll(
    /^import\s+(?:[\w$]+|\{[^}]*\}|\*\s+as\s+[\w$]+)\s+from\s+"@\/pages\/[^"]+"/gm,
  ),
].map((m) => m[0]);
check('router.tsx has no static `import ... from "@/pages/..."`', staticPageImports.length, 0);
if (staticPageImports.length > 0) {
  for (const line of staticPageImports) console.log("  static import:", line);
}

// --- every page reference is a dynamic import -------------------------------
const pageReferences = [...source.matchAll(/"@\/pages\/[^"]+"/g)].length;
const dynamicPageImports = [...source.matchAll(/\(\)\s*=>\s*import\("@\/pages\/[^"]+"\)/g)].length;
check("every @/pages reference is a `() => import(...)` thunk", dynamicPageImports, pageReferences);
check("all 38 pages are still routed", pageReferences >= 38, true);

// --- lazy + Suspense wiring ---------------------------------------------------
check("React.lazy is used", /\blazy\(/.test(source), true);
check("a Suspense boundary wraps lazy pages", /<Suspense\b/.test(source), true);
check(
  "no route element instantiates a page component directly (`element: <XPage />`)",
  /element:\s*<\w*Page\s*\/>/.test(source),
  false,
);
check(
  "route elements go through page() so each gets its own Suspense fallback",
  /element:\s*page\(/.test(source),
  true,
);

// --- §7.1: pending magistrates can reach Settings and Notifications ----------
// The ungated ProtectedRoute block (no requireApprovedMagistrateCourt) is the
// one whose element is exactly `<ProtectedRoute />`. Settings and
// Notifications must be routed there, not behind the approved-court gate.
const blocks = source.split(/element:\s*<ProtectedRoute\b/);
const ungated = blocks.find((b) => b.startsWith(" />") || b.startsWith("/>"));
check("an ungated ProtectedRoute block exists", typeof ungated, "string");
if (ungated) {
  check("ROUTES.settings is in the ungated block", ungated.includes("ROUTES.settings"), true);
  check(
    "ROUTES.notifications is in the ungated block",
    ungated.includes("ROUTES.notifications"),
    true,
  );
  check(
    "ROUTES.courtAssignments stays in the ungated block",
    ungated.includes("ROUTES.courtAssignments"),
    true,
  );
  check("ROUTES.home is NOT in the ungated block", ungated.includes("ROUTES.home"), false);
  check("ROUTES.docket is NOT in the ungated block", ungated.includes("ROUTES.docket,"), false);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
