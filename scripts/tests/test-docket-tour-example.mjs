/**
 * Empty-docket walkthrough example row: when to show it.
 *
 *   npm run test:walkthrough
 */
import { shouldShowDocketTourExample } from "../../src/lib/docket-tour-example.ts"

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

const emptyTour = {
  tourActive: true,
  matterCount: 0,
  emptyBecauseFilters: false,
  emptyBecauseDate: false,
}

check("tour on an empty docket shows the example", shouldShowDocketTourExample(emptyTour), true)
check(
  "tour off hides the example",
  shouldShowDocketTourExample({ ...emptyTour, tourActive: false }),
  false,
)
check(
  "a real matter hides the example",
  shouldShowDocketTourExample({ ...emptyTour, matterCount: 1 }),
  false,
)
check(
  "search or stage filters hide the example",
  shouldShowDocketTourExample({ ...emptyTour, emptyBecauseFilters: true }),
  false,
)
check(
  "a selected calendar date hides the example",
  shouldShowDocketTourExample({ ...emptyTour, emptyBecauseDate: true }),
  false,
)

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
