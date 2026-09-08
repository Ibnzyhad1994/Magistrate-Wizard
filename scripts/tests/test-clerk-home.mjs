import { clerkHomeState, clerkPendingDescription } from "../../src/lib/clerk-home.ts"

let failures = 0
function check(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${pass ? "PASS" : "FAIL"} — ${label}`)
  if (!pass) {
    console.log("  expected:", JSON.stringify(expected))
    console.log("  actual:  ", JSON.stringify(actual))
    failures += 1
  }
}

check(
  "courts still loading is not pending or ready",
  clerkHomeState({ courtsPending: true, courtCount: 0 }),
  "loading",
)
check(
  "a live clerk_courts row is ready even with zero approved requests",
  clerkHomeState({ courtsPending: false, courtCount: 1 }),
  "ready",
)
check(
  "no seat is pending",
  clerkHomeState({ courtsPending: false, courtCount: 0 }),
  "pending",
)
check(
  "pending copy names the court",
  clerkPendingDescription({ pendingRequestCount: 1, pendingCourtName: "Georgetown Magistrates' Court 1" }),
  "Your request to access the docket for Georgetown Magistrates' Court 1 is awaiting approval from the assigned magistrate.",
)
check(
  "zero requests asks them to request a court",
  clerkPendingDescription({ pendingRequestCount: 0 }),
  "Request access to a court to get started. The court's assigned magistrate will review your request.",
)

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
