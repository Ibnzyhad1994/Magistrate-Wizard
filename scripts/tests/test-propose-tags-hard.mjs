/**
 * Hard adversarial stress suite for proposeTags / proposeTagsScored.
 *
 *   node --experimental-strip-types --import ./scripts/test-support/register.mjs scripts/tests/test-propose-tags-hard.mjs
 */
import {
  proposeTags,
  proposeTagsScored,
  tagConfidenceFromScore,
  toTagProposalDetails,
  TAG_CONFIDENCE_HIGH_MIN,
} from "@/lib/legal-extraction"
import {
  AMBIGUOUS_SHORT_TAXONOMY_TOPICS,
  LEGAL_TAXONOMY_ALIASES,
  LEGAL_TAXONOMY_PHRASE_INDEX,
  LEGAL_TAXONOMY_TOPICS,
} from "@/lib/legal-taxonomy"

let failures = 0
const rows = []

const record = (label, pass, detail = "") => {
  rows.push({ label, pass, detail })
  if (!pass) failures += 1
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`)
}

const expectIncludes = (label, tags, name) =>
  record(label, tags.includes(name), `got=[${tags.join(", ")}]`)

const expectExcludes = (label, tags, name) =>
  record(label, !tags.includes(name), `got=[${tags.join(", ")}]`)

const expectEmpty = (label, tags) =>
  record(label, tags.length === 0, `got=[${tags.join(", ")}]`)

// ---------------------------------------------------------------------------
// Index integrity
// ---------------------------------------------------------------------------
{
  record("index non-empty", LEGAL_TAXONOMY_PHRASE_INDEX.length > LEGAL_TAXONOMY_TOPICS.length)
  for (const topic of LEGAL_TAXONOMY_TOPICS) {
    const hasSelf = LEGAL_TAXONOMY_PHRASE_INDEX.some(
      (e) => e.topic === topic && !e.isAlias && e.phrase === topic.toLowerCase(),
    )
    record(`index covers topic self-phrase: ${topic}`, hasSelf)
  }
  for (const [topic, aliases] of Object.entries(LEGAL_TAXONOMY_ALIASES)) {
    record(`alias key is canonical topic: ${topic}`, LEGAL_TAXONOMY_TOPICS.includes(topic))
    for (const alias of aliases) {
      const normalized = alias.trim().toLowerCase()
      const hit = LEGAL_TAXONOMY_PHRASE_INDEX.some(
        (e) => e.topic === topic && e.phrase === normalized,
      )
      // Alias identical to the topic label is stored as the self-phrase (isAlias=false).
      record(`alias indexed: ${topic} ← ${alias}`, hit)
    }
  }
  record(
    "ambiguous short set ⊆ taxonomy",
    [...AMBIGUOUS_SHORT_TAXONOMY_TOPICS].every((t) => LEGAL_TAXONOMY_TOPICS.includes(t)),
  )
}

// ---------------------------------------------------------------------------
// False-positive traps (substring / everyday English)
// ---------------------------------------------------------------------------
{
  const traps = [
    ["research / researcher / researched", "Counsel cited academic research by a researcher who researched the point.", "Search"],
    ["service industry prose", "The customer service industry provides a valuable service daily.", "Service"],
    ["knowledge everyday", "To my knowledge the meeting was cancelled for lack of knowledge sharing.", "Knowledge"],
    ["debt metaphorical", "We are in debt to prior courts for their reasoning on unrelated debt instruments in literature.", "Debt"],
    ["custody of documents figurative once", "The registrar retained custody of the file overnight.", "Custody"],
    ["quantity of time", "A large quantity of time was wasted on adjournments.", "Quantity"],
    ["possession of skill once", "Counsel showed possession of considerable skill in cross-examination.", "Possession"],
    ["search engine once", "The court was referred to a search engine result printout.", "Search"],
    ["bailiff not bail", "The bailiff executed the warrant of distress at the premises.", "Bail"],
    ["maintenance of order (not family)", "Maintenance of order in the courtroom is the duty of the police.", "Maintenance"],
    ["maintenance twice everyday", "Maintenance of order and maintenance of records are clerical duties.", "Maintenance"],
    ["service×2 still below bare floor", "Customer service failed; the service desk closed early.", "Service"],
    ["knowledge×2 still below bare floor", "To my knowledge nobody attended. Knowledge sharing was poor.", "Knowledge"],
    ["debt×2 still below bare floor", "In debt to history, and a debt of gratitude remains.", "Debt"],
  ]

  for (const [label, text, forbidden] of traps) {
    expectExcludes(`FP trap — ${label}`, proposeTags(text), forbidden)
  }
}

// ---------------------------------------------------------------------------
// True positives + aliases
// ---------------------------------------------------------------------------
{
  expectIncludes(
    "TP — hearsay evidence",
    proposeTags("The statement was admitted as hearsay evidence over objection."),
    "Hearsay",
  )
  expectIncludes(
    "TP — no case to answer",
    proposeTags("A no case to answer submission was upheld."),
    "No-Case Submission",
  )
  expectIncludes(
    "TP — voir dire / trial within a trial",
    proposeTags("A trial within a trial was held on voluntariness."),
    "Voir Dire",
  )
  expectIncludes(
    "TP — search and seizure",
    proposeTags("The unlawful search of the dwelling was challenged."),
    "Search and Seizure",
  )
  expectIncludes(
    "TP — burden of proof alias",
    proposeTags("The burden of proof remains on the prosecution throughout."),
    "Burden and Standard of Proof",
  )
  expectIncludes(
    "TP — similar fact",
    proposeTags("The Crown sought to adduce similar-fact evidence of prior assaults."),
    "Similar Fact Evidence",
  )
  expectIncludes(
    "TP — domestic violence / protection order",
    proposeTags("A protection order was sought under the Domestic Violence Act."),
    "Domestic Violence",
  )
  expectIncludes(
    "TP — best interests of the child",
    proposeTags("The welfare of the child is the paramount consideration."),
    "Best Interests of the Child",
  )
  expectIncludes(
    "TP — service of process alias",
    proposeTags("Affidavit of service of process was filed late."),
    "Service",
  )
  expectIncludes(
    "TP — joint possession",
    proposeTags("The case turned on joint possession of the cannabis."),
    "Joint Possession",
  )
  expectIncludes(
    "TP — dangerous driving",
    proposeTags("He was charged with dangerous driving contrary to the Act."),
    "Dangerous Driving",
  )
  expectIncludes(
    "TP — guilty plea alias",
    proposeTags("The accused pleaded guilty to the second count."),
    "Guilty Plea",
  )
}

// ---------------------------------------------------------------------------
// Short-token floor
// ---------------------------------------------------------------------------
{
  expectExcludes(
    "floor — Bail once",
    proposeTags("The clerk noted bail in the diary and moved on."),
    "Bail",
  )
  expectExcludes(
    "floor — Bail twice bare below floor",
    proposeTags("The accused applied for bail. The court refused bail."),
    "Bail",
  )
  expectIncludes(
    "floor — Bail via alias once",
    proposeTags("A contested bail application was listed."),
    "Bail",
  )
  expectExcludes(
    "floor — Possession once",
    proposeTags("Possession was mentioned once in submissions."),
    "Possession",
  )
  expectIncludes(
    "floor — Possession thrice",
    proposeTags("Possession was denied. Later possession was argued. The court found possession proved."),
    "Possession",
  )
  expectExcludes(
    "floor — Search once (engine)",
    proposeTags("A search of the court file revealed nothing."),
    "Search",
  )
  expectIncludes(
    "floor — Search thrice",
    proposeTags("A search of the vehicle followed a search of the bag and a further search of the home."),
    "Search",
  )
  expectIncludes(
    "floor — Custody thrice",
    proposeTags(
      "Custody of the child was disputed. Interim custody was granted. Final custody remained with the mother.",
    ),
    "Custody",
  )
  expectIncludes(
    "floor — Bail thrice bare",
    proposeTags("Bail was sought. Bail was opposed. Bail was refused."),
    "Bail",
  )
}

// ---------------------------------------------------------------------------
// Specificity demotion
// ---------------------------------------------------------------------------
{
  const tags = proposeTags(
    "The defence attacked the search and seizure as unconstitutional and without warrant.",
  )
  expectIncludes("specificity — keeps Search and Seizure", tags, "Search and Seizure")
  expectExcludes("specificity — drops bare Search", tags, "Search")

  const joint = proposeTags("The Crown alleged joint possession of the packages.")
  expectIncludes("specificity — keeps Joint Possession", joint, "Joint Possession")
  // Possession may still appear if "possession" also hits twice via the phrase —
  // demotion should suppress short Possession when Joint Possession is kept.
  expectExcludes("specificity — drops bare Possession under Joint Possession", joint, "Possession")

  const visual = proposeTags(
    "The case turned on visual identification by a single dock witness.",
  )
  expectIncludes("specificity — Visual Identification", visual, "Visual Identification")
}

// ---------------------------------------------------------------------------
// Ranking / limit / scored API
// ---------------------------------------------------------------------------
{
  const scored = proposeTagsScored(
    "hearsay evidence. similar fact evidence. search and seizure. no case to answer. " +
      "burden of proof. guilty plea. domestic violence. dangerous driving. " +
      "expert evidence. disclosure obligations. bail application. trafficking in narcotics.",
    5,
  )
  record("scored — respects limit 5", scored.length === 5, `len=${scored.length}`)
  record(
    "scored — descending score",
    scored.every((t, i) => i === 0 || scored[i - 1].score >= t.score),
    scored.map((t) => `${t.name}:${t.score}`).join(", "),
  )
  const names = proposeTags(
    "hearsay evidence. similar fact evidence. search and seizure. no case to answer.",
    3,
  )
  record("proposeTags limit 3", names.length === 3, `got=${names.join(", ")}`)
}

// ---------------------------------------------------------------------------
// Noise / encoding / punctuation
// ---------------------------------------------------------------------------
{
  expectIncludes(
    "punct — hyphenated similar-fact",
    proposeTags("Admission of similar-fact evidence was refused."),
    "Similar Fact Evidence",
  )
  expectIncludes(
    "punct — quotes around hearsay",
    proposeTags('The “hearsay” objection was overruled.'),
    "Hearsay",
  )
  expectIncludes(
    "case — ALL CAPS NO CASE TO ANSWER",
    proposeTags("AT THE CLOSE A NO CASE TO ANSWER WAS MADE."),
    "No-Case Submission",
  )
  expectEmpty("noise — binary-ish garbage", proposeTags("\u0000\u0001\u0002%%%@@@###"))
  expectEmpty("noise — numbers only", proposeTags("12345 67890 0.001"))
}

// ---------------------------------------------------------------------------
// Ramsingh-shaped judgment body (realistic mix)
// ---------------------------------------------------------------------------
{
  const ramsingh =
    "The State v Dhannie Ramsingh (1973) 20 WIR 138 COURT OF APPEAL OF GUYANA\n" +
    "The appellant was convicted of manslaughter. Counsel submitted that certain " +
    "admissions were wrongly admitted as hearsay evidence and that the trial judge " +
    "misdirected the jury. The court considered the relevant authorities on " +
    "admissibility before dismissing the appeal. A further appeal might lie to the Privy Council."
  const tags = proposeTags(ramsingh)
  expectIncludes("Ramsingh — Hearsay", tags, "Hearsay")
  expectIncludes("Ramsingh — Admissibility", tags, "Admissibility")
  expectExcludes("Ramsingh — no Search from research-like words", tags, "Search")
  record("Ramsingh — proposal count sensible (1–10)", tags.length >= 1 && tags.length <= 10, `n=${tags.length} [${tags.join(", ")}]`)
}

// ---------------------------------------------------------------------------
// Narcotics judgment mix
// ---------------------------------------------------------------------------
{
  const narc =
    "The accused was charged with trafficking in narcotics and possession of cannabis. " +
    "The defence challenged the search and seizure of the parcels and argued absence of " +
    "knowledge and lack of custody and control. Quantity was small. Joint possession was alternative."
  const tags = proposeTags(narc)
  expectIncludes("Narc — Trafficking", tags, "Trafficking")
  expectIncludes("Narc — Search and Seizure", tags, "Search and Seizure")
  expectIncludes("Narc — Custody and Control", tags, "Custody and Control")
  expectIncludes("Narc — Joint Possession", tags, "Joint Possession")
  expectExcludes("Narc — bare Search demoted", tags, "Search")
}

// ---------------------------------------------------------------------------
// Performance / scale
// ---------------------------------------------------------------------------
{
  const pad = "The court adjourned without comment on unrelated administrative matters. ".repeat(400)
  const needle =
    "Finally the court addressed hearsay evidence and a no case to answer submission. " + pad
  const t0 = Date.now()
  const tags = proposeTags(needle)
  const ms = Date.now() - t0
  expectIncludes("perf — finds Hearsay in long doc", tags, "Hearsay")
  expectIncludes("perf — finds No-Case Submission in long doc", tags, "No-Case Submission")
  record("perf — long mixed doc < 400ms", ms < 400, `${ms}ms`)

  // Two mentions of bare "bail" must NOT clear the raised floor (need 3 or alias).
  expectExcludes(
    "floor — Bail twice bare still below floor",
    proposeTags("Bail was sought. The court refused bail."),
    "Bail",
  )

  const huge = "x".repeat(200_000) + " hearsay evidence " + "y".repeat(50_000)
  const t1 = Date.now()
  const tags2 = proposeTags(huge)
  const ms2 = Date.now() - t1
  // Scan window is 80k — needle after 200k may be truncated; assert either found
  // within window behavior is honest: only first 80k scanned.
  record(
    "perf — 250k char input completes < 400ms",
    ms2 < 400,
    `${ms2}ms tags=[${tags2.join(", ")}]`,
  )

  const withinWindow = "hearsay evidence " + "z".repeat(70_000)
  expectIncludes("perf — hit inside 80k window", proposeTags(withinWindow), "Hearsay")
  const outsideWindow = "z".repeat(85_000) + " hearsay evidence "
  expectExcludes(
    "perf — hit beyond 80k window ignored (cap honesty)",
    proposeTags(outsideWindow),
    "Hearsay",
  )
}

// ---------------------------------------------------------------------------
// Idempotence / stability
// ---------------------------------------------------------------------------
{
  const text =
    "Disclosure obligations, abuse of process, and jurisdiction were argued together with admissibility."
  const a = proposeTags(text)
  const b = proposeTags(text)
  record("stable — same input same output", JSON.stringify(a) === JSON.stringify(b), `${a} vs ${b}`)
  const scored = proposeTagsScored(text)
  record(
    "stable — scored names match proposeTags",
    JSON.stringify(scored.map((s) => s.name)) === JSON.stringify(a),
  )
  record(
    "stable — every scored row has confidence",
    scored.every((s) => s.confidence === tagConfidenceFromScore(s.score)),
  )
}

// ---------------------------------------------------------------------------
// Negation lookbehind
// ---------------------------------------------------------------------------
{
  expectExcludes(
    "negation — not hearsay alone",
    proposeTags("Counsel submitted that this was not hearsay at all."),
    "Hearsay",
  )
  expectExcludes(
    "negation — without jurisdiction alone",
    proposeTags("The objection was that the court was without jurisdiction to hear the claim."),
    "Jurisdiction",
  )
  expectExcludes(
    "negation — no jurisdiction alone",
    proposeTags("It was argued there was no jurisdiction over the accused."),
    "Jurisdiction",
  )
  expectIncludes(
    "negation — positive hearsay still works nearby",
    proposeTags("This was not hearsay. Later the court admitted hearsay evidence on another count."),
    "Hearsay",
  )
  expectIncludes(
    "negation — no case to answer is not negated",
    proposeTags("At the close a no case to answer submission was made."),
    "No-Case Submission",
  )
}

// ---------------------------------------------------------------------------
// Legal-section weighting
// ---------------------------------------------------------------------------
{
  const inHeld = proposeTagsScored(
    "Boilerplate preface only.\n\nHELD: The court admitted the hearsay evidence after full argument.\n",
  ).find((t) => t.name === "Hearsay")
  const inBoiler = proposeTagsScored(
    "In passing the transcript mentioned hearsay evidence once amid clerical notes and listing matters with no holding.\n",
  ).find((t) => t.name === "Hearsay")
  record("section — HELD hit proposes Hearsay", !!inHeld, inHeld ? `score=${inHeld.score}` : "missing")
  record("section — boilerplate also proposes (still a hit)", !!inBoiler)
  if (inHeld && inBoiler) {
    record(
      "section — HELD score >= boilerplate score",
      inHeld.score >= inBoiler.score,
      `held=${inHeld.score} boiler=${inBoiler.score}`,
    )
    record("section — inLegalSection flag on HELD hit", inHeld.inLegalSection === true)
  }
}

// ---------------------------------------------------------------------------
// New Caribbean / magistrates aliases
// ---------------------------------------------------------------------------
{
  expectIncludes(
    "alias — recognizance → Bail",
    proposeTags("The accused was released on his own recognizance pending trial."),
    "Bail",
  )
  expectIncludes(
    "alias — Turnbull → Identification",
    proposeTags("The Turnbull guidelines were carefully applied to the dock identification."),
    "Identification",
  )
  expectIncludes(
    "alias — occupation order → Domestic Violence",
    proposeTags("An occupation order was granted under the domestic violence legislation."),
    "Domestic Violence",
  )
  expectIncludes(
    "alias — arrears of maintenance → Maintenance",
    proposeTags("The complainant sought arrears of maintenance for three years."),
    "Maintenance",
  )
  expectIncludes(
    "alias — dangerous drugs → Trafficking",
    proposeTags("He was charged with trafficking in dangerous drugs contrary to the Act."),
    "Trafficking",
  )
  expectIncludes(
    "alias — submission of no case",
    proposeTags("A submission of no case was rejected after brief argument."),
    "No-Case Submission",
  )
}

// ---------------------------------------------------------------------------
// Confidence helper + tag_proposals shape
// ---------------------------------------------------------------------------
{
  record("confidence — high threshold constant", TAG_CONFIDENCE_HIGH_MIN === 40)
  record("confidence — score 50 is high", tagConfidenceFromScore(50) === "high")
  record("confidence — score 30 is medium", tagConfidenceFromScore(30) === "medium")
  record("confidence — score 10 is low", tagConfidenceFromScore(10) === "low")

  const scored = proposeTagsScored(
    "HELD: The court admitted hearsay evidence and upheld a search and seizure challenge after a no case to answer submission.",
  )
  const details = toTagProposalDetails(scored)
  record(
    "confidence — toTagProposalDetails preserves names",
    details.map((d) => d.name).join("|") === scored.map((s) => s.name).join("|"),
  )
  record(
    "confidence — strong fixture has at least one high",
    details.some((d) => d.confidence === "high"),
    details.map((d) => `${d.name}:${d.confidence}:${d.score}`).join(", "),
  )
}

console.log("\n--- proposeTags hard suite ---")
console.log(`Total ${rows.length}  passed ${rows.length - failures}  failed ${failures}`)
if (failures) {
  console.log("Failures:")
  for (const r of rows.filter((x) => !x.pass)) {
    console.log(`  - ${r.label}${r.detail ? `: ${r.detail}` : ""}`)
  }
}
process.exit(failures > 0 ? 1 : 0)
