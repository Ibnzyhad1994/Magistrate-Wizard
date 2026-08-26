import {
  visibleFacetOptions,
  facetOptionLabel,
  isFacetSelectionValid,
} from "../../src/lib/case-law-facets.ts";

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

const courts = [
  { id: "ccj", canonical_name: "Caribbean Court of Justice" },
  { id: "jcpc", canonical_name: "Privy Council" },
  { id: "gy-ca", canonical_name: "Guyana Court of Appeal" },
];

// --- visibleFacetOptions ---------------------------------------------------

check(
  "no options while counts haven't loaded (undefined) -- never briefly shows the full unfiltered list",
  visibleFacetOptions(courts, undefined),
  [],
);

check(
  "no options when the reference list itself hasn't loaded",
  visibleFacetOptions(undefined, new Map([["ccj", 3]])),
  [],
);

check(
  "empty counts map -- every option has zero accessible records, none shown",
  visibleFacetOptions(courts, new Map()),
  [],
);

check(
  "only options with a matching count survive, in the original reference order",
  visibleFacetOptions(courts, new Map([["ccj", 5], ["gy-ca", 2]])),
  [courts[0], courts[2]],
);

check(
  "an option with an accessible-but-zero-labeled count (shouldn't happen from the RPC, but) still counts as present if the key exists",
  visibleFacetOptions(courts, new Map([["ccj", 0]])),
  [courts[0]],
);

// --- facetOptionLabel --------------------------------------------------

check("labels with a nonzero count", facetOptionLabel("Robbery", 4), "Robbery (4)");
check("labels with no count entry as the bare name", facetOptionLabel("Robbery", undefined), "Robbery");
check("labels with an explicit zero count as the bare name (falsy)", facetOptionLabel("Robbery", 0), "Robbery");

// --- isFacetSelectionValid -----------------------------------------------

check("no selection is always valid", isFacetSelectionValid(null, new Map()), true);
check(
  "a selection stays valid while counts are still loading (undefined) -- avoids flicker-clearing",
  isFacetSelectionValid("ccj", undefined),
  true,
);
check(
  "a selection present in the fresh counts map is valid",
  isFacetSelectionValid("ccj", new Map([["ccj", 3]])),
  true,
);
check(
  "a selection absent from the fresh counts map is invalid -- caller clears it",
  isFacetSelectionValid("ccj", new Map([["gy-ca", 3]])),
  false,
);
check(
  "a selection absent from an EMPTY counts map is invalid",
  isFacetSelectionValid("ccj", new Map()),
  false,
);

if (failures > 0) {
  console.log(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log("\nAll case-law-facets tests passed.");
