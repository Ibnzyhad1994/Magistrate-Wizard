/**
 * Before/after comparison: naive substring tagging vs current proposeTagsScored.
 *
 *   node --experimental-strip-types --import ./scripts/test-support/register.mjs scripts/tests/compare-propose-tags-before-after.mjs
 */
import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { proposeTags, proposeTagsScored } from "@/lib/legal-extraction"
import { LEGAL_TAXONOMY_TOPICS } from "@/lib/legal-taxonomy"

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, "propose-tags-before-after.json")

/** Pre-hardening behavior: case-insensitive substring includes, no aliases/negation/floor. */
const proposeTagsBefore = (text, limit = 10) => {
  if (!text?.trim()) return []
  const lower = text.toLowerCase()
  const hits = LEGAL_TAXONOMY_TOPICS.filter((topic) => lower.includes(topic.toLowerCase()))
  return Array.from(new Set(hits)).slice(0, limit)
}

const FIXTURES = [
  {
    id: "fp-research",
    label: "False positive: research ⊃ Search",
    text: "Counsel cited academic research by a researcher who researched the point.",
    expectAfter: { exclude: ["Search"] },
  },
  {
    id: "negation-hearsay",
    label: "Negation: not hearsay",
    text: "Counsel submitted that this was not hearsay at all.",
    expectAfter: { exclude: ["Hearsay"] },
  },
  {
    id: "negation-jurisdiction",
    label: "Negation: without jurisdiction",
    text: "The objection was that the court was without jurisdiction to hear the claim.",
    expectAfter: { exclude: ["Jurisdiction"] },
  },
  {
    id: "alias-recognizance",
    label: "New alias: recognizance → Bail",
    text: "The accused was released on his own recognizance pending trial.",
    expectAfter: { include: ["Bail"] },
  },
  {
    id: "alias-turnbull",
    label: "New alias: Turnbull → Identification",
    text: "The Turnbull guidelines were carefully applied to the dock identification.",
    expectAfter: { include: ["Identification"] },
  },
  {
    id: "alias-no-case",
    label: "Alias: no case to answer",
    text: "At the close a no case to answer submission was made.",
    expectAfter: { include: ["No-Case Submission"] },
  },
  {
    id: "specificity-search",
    label: "Specificity: Search and Seizure vs Search",
    text: "The defence attacked the search and seizure as unconstitutional.",
    expectAfter: { include: ["Search and Seizure"], exclude: ["Search"] },
  },
  {
    id: "floor-bail-once",
    label: "Short-token floor: bail once",
    text: "The clerk noted bail in the diary and moved on.",
    expectAfter: { exclude: ["Bail"] },
  },
  {
    id: "floor-bail-alias",
    label: "Short-token floor: bail application",
    text: "A contested bail application was listed.",
    expectAfter: { include: ["Bail"] },
  },
  {
    id: "held-hearsay",
    label: "HELD section hearsay (confidence)",
    text: "Boilerplate preface.\n\nHELD: The court admitted the hearsay evidence after full argument.\n",
    expectAfter: { include: ["Hearsay"], high: ["Hearsay"] },
  },
  {
    id: "ramsingh",
    label: "Ramsingh-shaped judgment",
    text:
      "The State v Dhannie Ramsingh (1973) 20 WIR 138 COURT OF APPEAL OF GUYANA\n" +
      "The appellant was convicted of manslaughter. Counsel submitted that certain " +
      "admissions were wrongly admitted as hearsay evidence and that the trial judge " +
      "misdirected the jury. The court considered the relevant authorities on " +
      "admissibility before dismissing the appeal. A further appeal might lie to the Privy Council.",
    expectAfter: { include: ["Hearsay"], exclude: ["Search"] },
  },
  {
    id: "narcotics",
    label: "Narcotics mix",
    text:
      "Charged with trafficking in dangerous drugs. Defence challenged the search and seizure " +
      "and argued lack of custody and control. Joint possession was alternative.",
    expectAfter: {
      include: ["Trafficking", "Search and Seizure", "Custody and Control", "Joint Possession"],
      exclude: ["Search"],
    },
  },
  {
    id: "service-fp",
    label: "False positive: customer service",
    text: "The customer service industry provides a valuable service daily.",
    expectAfter: { exclude: ["Service"] },
  },
]

const eqSet = (a, b) => {
  if (a.length !== b.length) return false
  const sa = [...a].sort().join("\0")
  const sb = [...b].sort().join("\0")
  return sa === sb
}

const rows = []
let improved = 0
let unchanged = 0
let regress = 0

for (const fix of FIXTURES) {
  const before = proposeTagsBefore(fix.text)
  const after = proposeTags(fix.text)
  const scored = proposeTagsScored(fix.text)
  const high = scored.filter((s) => s.confidence === "high").map((s) => s.name)

  const added = after.filter((t) => !before.includes(t))
  const removed = before.filter((t) => !after.includes(t))
  const same = eqSet(before, after)

  let ok = true
  const problems = []
  for (const name of fix.expectAfter.include ?? []) {
    if (!after.includes(name)) {
      ok = false
      problems.push(`missing ${name}`)
    }
  }
  for (const name of fix.expectAfter.exclude ?? []) {
    if (after.includes(name)) {
      ok = false
      problems.push(`still has ${name}`)
    }
  }
  for (const name of fix.expectAfter.high ?? []) {
    if (!high.includes(name)) {
      ok = false
      problems.push(`${name} not high`)
    }
  }

  // Before often fails the same expectations — track delta quality
  let beforeOk = true
  for (const name of fix.expectAfter.include ?? []) {
    if (!before.includes(name)) beforeOk = false
  }
  for (const name of fix.expectAfter.exclude ?? []) {
    if (before.includes(name)) beforeOk = false
  }

  if (!beforeOk && ok) improved += 1
  else if (beforeOk && ok && same) unchanged += 1
  else if (beforeOk && !ok) regress += 1
  else if (!beforeOk && !ok) {
    /* both wrong — rare */
  } else if (beforeOk && ok && !same) improved += 1 // refined list
  else if (!same && ok) improved += 1

  const row = {
    id: fix.id,
    label: fix.label,
    before,
    after,
    high,
    scored: scored.map((s) => ({ name: s.name, score: s.score, confidence: s.confidence })),
    added,
    removed,
    same,
    afterOk: ok,
    beforeOk,
    problems,
  }
  rows.push(row)

  const mark = ok ? "PASS" : "FAIL"
  const delta =
    same ? "unchanged" : `−[${removed.join(", ") || "—"}] +[${added.join(", ") || "—"}]`
  console.log(`${mark}  ${fix.label}`)
  console.log(`      BEFORE: [${before.join(", ") || "(none)"}]`)
  console.log(`      AFTER:  [${after.join(", ") || "(none)"}]${high.length ? `  high=[${high.join(", ")}]` : ""}`)
  console.log(`      DELTA:  ${delta}${problems.length ? `  (${problems.join("; ")})` : ""}`)
}

const payload = {
  generatedAt: new Date().toISOString(),
  summary: {
    fixtures: rows.length,
    afterPass: rows.filter((r) => r.afterOk).length,
    beforePass: rows.filter((r) => r.beforeOk).length,
    improved,
    unchangedCorrect: rows.filter((r) => r.beforeOk && r.afterOk && r.same).length,
    regressions: regress,
  },
  rows,
}
writeFileSync(OUT, JSON.stringify(payload, null, 2))

console.log("\n--- Before vs After ---")
console.log(
  `Fixtures ${payload.summary.fixtures}  |  before OK ${payload.summary.beforePass}  |  after OK ${payload.summary.afterPass}  |  improved ${improved}  |  regressions ${regress}`,
)
console.log("Results:", OUT)
process.exit(rows.some((r) => !r.afterOk) || regress > 0 ? 1 : 0)
