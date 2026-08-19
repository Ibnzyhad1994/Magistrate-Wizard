import {
  evaluateSeedItem,
  isCatalogFilename,
  isEligibleSeedItem,
} from "../seed-legal-library/seed-heuristics.mjs";

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

check("catalog filename accepts numbered JSON", isCatalogFilename("03-ccj-guyana.json"), true);
check("catalog filename rejects scratch JSON", isCatalogFilename("_batch_inspect.json"), false);

check(
  "Parliament Act with official URL and Act number is eligible",
  isEligibleSeedItem({
    kind: "legislation",
    title: "Sexual Offences Act 2010",
    code: "7 of 2010",
    jurisdiction: "Guyana",
    source_url: "https://www.parliament.gov.gy/publications/acts-of-parliament/sexual-offences-act-2010",
    full_text: "AN ACT to reform the law relating to sexual offences.",
  }),
  true,
);

check(
  "MoLA chapter catalog without body text is still eligible",
  isEligibleSeedItem({
    kind: "legislation",
    title: "Evidence Act",
    code: "Cap. 5:03",
    jurisdiction: "Guyana",
    source_url: "https://www.mola.gov.gy/laws/005-03-Evidence-Act.pdf",
    full_text: "",
  }),
  true,
);

check(
  "Parliament Act title without code still eligible when official URL names an Act",
  isEligibleSeedItem({
    kind: "legislation",
    title: "Court of Appeal (Amendment) Act",
    code: null,
    jurisdiction: "Guyana",
    source_url: "https://www.parliament.gov.gy/publications/acts-of-parliament/court-of-appeal-amendment-act",
    original_filename: "24366-24344-act_no._5_of_2025.pdf",
  }),
  true,
);

check(
  "budget Act is not seed material",
  isEligibleSeedItem({
    kind: "legislation",
    title: "Appropriation Act 2024",
    code: "1 of 2024",
    jurisdiction: "Guyana",
    source_url: "https://www.parliament.gov.gy/publications/acts-of-parliament/appropriation-act-2024",
  }),
  false,
);

check(
  "non-Guyana legislation is rejected",
  isEligibleSeedItem({
    kind: "legislation",
    title: "Some Act",
    code: "1 of 2020",
    jurisdiction: "Trinidad and Tobago",
    source_url: "https://www.parliament.gov.gy/publications/acts-of-parliament/some-act",
  }),
  false,
);

check(
  "CCJ Guyana appeal with citation and v-name is eligible",
  isEligibleSeedItem({
    kind: "case_law",
    title: "Bridgelall v Hariprashad",
    citation: "[2017] CCJ 8 (AJ)",
    court: "Caribbean Court of Justice",
    jurisdiction: "Guyana",
    source_url: "https://ccj.org/wp-content/uploads/2017/05/2017-CCJ-8-AJ.pdf",
    full_text: "IN THE CARIBBEAN COURT OF JUSTICE",
  }),
  true,
);

const gba = evaluateSeedItem({
  kind: "case_law",
  title: "unsel to the defendants. On the application by counsel",
  citation: "[1968] 1 G.L.R.",
  court: "High Court of Guyana",
  jurisdiction: "Guyana",
  source_url: "http://guyanabarassociation.org/ba/bac/media/1968.pdf",
  full_text: "discretion under s. 19 cannot be reviewed",
});
check("GBA volume PDF with prose-fragment title is rejected", gba.eligible, false);
check(
  "GBA rejection mentions host or case name",
  gba.reasons.some((r) => /host|Party v Party|official/i.test(r)),
  true,
);

check(
  "case law without citation is rejected",
  isEligibleSeedItem({
    kind: "case_law",
    title: "Smith v Jones",
    source_url: "https://ccj.org/judgments/smith.pdf",
  }),
  false,
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
