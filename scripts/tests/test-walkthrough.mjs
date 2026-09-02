import { walkthroughStepsFor } from "../../src/lib/walkthrough.ts";

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

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
