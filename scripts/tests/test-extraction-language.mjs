// Honesty gate for extracted language/script.
// Caribbean legal prose is Latin (including accented names). Wrong-script
// CMap output and latin1 mojibake must not be sold as a successful extract.
//
//   node --experimental-strip-types --import ./scripts/test-support/register.mjs scripts/tests/test-extraction-language.mjs

import { assessExtractionLanguage } from "@/lib/extraction-language"
import { runPdfExtractionPipeline } from "@/lib/extraction-pipeline"
import { terminateOcrWorker } from "@/lib/ocr/engine"
import { makeWellFormedCidToUnicodePdf } from "../test-support/pdf-fixtures.mjs"

let failures = 0
const check = (label, actual, expected) => {
  const pass = actual === expected
  console.log(`${pass ? "PASS" : "FAIL"} - ${label}`)
  if (!pass) {
    console.log("  expected:", expected)
    console.log("  actual:  ", actual)
    failures += 1
  }
}

const english =
  "The appellant was convicted of manslaughter in the High Court of Guyana. " +
  "Counsel submitted that certain admissions were wrongly admitted as hearsay. " +
  "The Court of Appeal dismissed the appeal and affirmed the conviction."

{
  const r = assessExtractionLanguage(english)
  check("English judgment is honest Latin", r.ok, true)
  check("English judgment has no language reason", r.reason, null)
}

{
  const r = assessExtractionLanguage(
    english +
      " Testimony of José François O'Neil-Smith at the naïve café in Georgetown. " +
      "See § 12 of the Evidence Act.",
  )
  check("accented Caribbean names stay honest Latin", r.ok, true)
}

{
  const han = Array.from({ length: 80 }, () => "中华人民共和国人民法院判决书").join(" ")
  const r = assessExtractionLanguage(han)
  check("Han-script dump is not honest", r.ok, false)
  check("Han-script dump reason is wrong_script", r.reason, "wrong_script")
}

{
  const mixed =
    english +
    " " +
    Array.from({ length: 40 }, () => "被告上诉人判决").join("")
  const r = assessExtractionLanguage(mixed)
  check("English mixed with a CJK CMap dump is not honest", r.ok, false)
  check("mixed CJK reason is wrong_script", r.reason, "wrong_script")
}

{
  const mojibake = Array.from(
    { length: 12 },
    () => "The appellant JosÃ© submitted that the judge Ã©rred on Ã©vidence at the cafÃ©.",
  ).join(" ")
  const r = assessExtractionLanguage(mojibake)
  check("latin1 mojibake is not honest", r.ok, false)
  check("mojibake reason is mojibake", r.reason, "mojibake")
}

{
  const file = makeWellFormedCidToUnicodePdf([
    "The appellant JosÃ© submitted that the learned trial judge Ã©rred regarding Ã©vidence.",
    "Further submissions concerned the cafÃ© witness and whether Ã©vidence was fairly put.",
    "The Court considered the authorities at length before dismissing the appeal.",
    "Held that the summing up was adequate and the conviction is accordingly affirmed.",
  ])
  const envelope = await runPdfExtractionPipeline(file)
  const soldMalformed =
    (envelope.status === "extracted" || envelope.status === "low_quality") && /Ã/.test(envelope.text)
  check("mojibake PDF is not sold as extracted text", soldMalformed, false)
}

{
  const file = makeWellFormedCidToUnicodePdf([
    "The appellant was convicted of manslaughter in the High Court of Guyana.",
    "Counsel for José François submitted that certain admissions were hearsay.",
    "The Court of Appeal dismissed the appeal after considering the summing up.",
  ])
  const envelope = await runPdfExtractionPipeline(file)
  check("accented Latin PDF still extracts", envelope.status, "extracted")
  check("accented Latin PDF keeps José", envelope.text.includes("José"), true)
}

{
  const file = makeWellFormedCidToUnicodePdf([
    "The appellant was convicted of manslaughter in the High Court of Guyana.",
    "Counsel submitted that certain admissions were wrongly admitted as hearsay evidence.",
    "The Court of Appeal considered the authorities and dismissed the appeal.",
    "被告上诉人判决书被告上诉人判决书被告上诉人判决书被告上诉人",
  ])
  const envelope = await runPdfExtractionPipeline(file)
  const soldWrongScript =
    (envelope.status === "extracted" || envelope.status === "low_quality") && /[\u4e00-\u9fff]/.test(envelope.text)
  check("CJK CMap dump mixed into English is not sold as extracted text", soldWrongScript, false)
}

if (failures > 0) {
  console.error(`\n${failures} extraction-language test(s) failed`)
  try {
    await terminateOcrWorker()
  } catch {
    /* ignore */
  }
  process.exit(1)
}
try {
  await terminateOcrWorker()
} catch {
  /* ignore */
}
console.log("\nALL PASS")
process.exit(0)
