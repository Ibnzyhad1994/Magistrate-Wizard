import {
  actorDisplayName,
  changedFields,
  matchesActivityQuery,
  summarizeAuthEvent,
  summarizeChange,
  tablesForFilter,
} from "@/lib/audit-activity"

let failures = 0
const check = (label, actual, expected) => {
  const pass = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${pass ? "PASS" : "FAIL"} — ${label}`)
  if (!pass) {
    console.log("  expected:", JSON.stringify(expected))
    console.log("  actual:  ", JSON.stringify(actual))
    failures += 1
  }
}

check(
  "role promotion is a privilege event, not a generic update",
  summarizeChange("profiles", "update", { role: "magistrate", email: "a@court.gy", full_name: "A Magistrate" }, { role: "admin", email: "a@court.gy", full_name: "A Magistrate" }).title,
  "Role changed from magistrate to admin",
)

check(
  "deactivation is named as such",
  summarizeChange("profiles", "update", { is_active: true, email: "a@court.gy" }, { is_active: false, email: "a@court.gy" }).title,
  "Account deactivated",
)

check(
  "signup insert records the provisioned role",
  summarizeChange("profiles", "insert", null, { role: "clerk", email: "clerk@court.gy" }).title,
  "Account created (clerk)",
)

check(
  "library events are categorized separately from access",
  summarizeChange("statutes", "insert", null, { title: "Summary Jurisdiction Act" }).category,
  "library",
)

check(
  "judgment-shaped payloads are not an institutional table in the viewer",
  tablesForFilter("all").includes("judgments") || tablesForFilter("all").includes("bench_notes"),
  false,
)

check(
  "sign-in filter does not query change tables",
  tablesForFilter("signin"),
  [],
)

check(
  "full_text never appears in the details grid",
  changedFields(
    { title: "Act", full_text: "SECRET JUDICIAL TEXT" },
    { title: "Act (rev)", full_text: "SECRET JUDICIAL TEXT CHANGED" },
  ).some((row) => row.label.includes("full")),
  false,
)

check(
  "title change is visible without dumping the body",
  changedFields({ title: "Act" }, { title: "Act (rev)" }),
  [{ label: "title", from: "Act", to: "Act (rev)" }],
)

check(
  "failed sign-in keeps the attempted email as the subject",
  summarizeAuthEvent("login_failed", "intruder@example.com").subject,
  "intruder@example.com",
)

check(
  "actor falls back to email then Unknown",
  [actorDisplayName({ full_name: "Sam", email: "s@x" }), actorDisplayName(null, "s@x"), actorDisplayName(null, null)],
  ["Sam", "s@x", "Unknown"],
)

check(
  "search is case-insensitive across title and actor",
  matchesActivityQuery("MAGIS", ["Role changed", "A Magistrate", "admin@court.gy"]),
  true,
)

check(
  "docket is an institutional table and has its own filter",
  tablesForFilter("docket"),
  ["docket_matters"],
)

check(
  "docket create names the case",
  summarizeChange("docket_matters", "insert", null, { case_number: "123/2026", matter_title: "Police v. Doe" }).title,
  "Docket matter created: 123/2026 · Police v. Doe",
)

check(
  "identity edit is named, not a generic update",
  summarizeChange(
    "docket_matters",
    "update",
    { case_number: "123/2026", matter_title: "Police v. Doe", charge_or_issue: "Theft" },
    { case_number: "124/2026", matter_title: "Police v. Doe", charge_or_issue: "Theft" },
  ).title,
  "Matter case number updated",
)

check(
  "bin is named from deleted_at going set",
  summarizeChange(
    "docket_matters",
    "update",
    { case_number: "123/2026", matter_title: "Police v. Doe", deleted_at: null },
    { case_number: "123/2026", matter_title: "Police v. Doe", deleted_at: "2026-09-01T00:00:00Z" },
  ).title,
  "Moved to bin: 123/2026 · Police v. Doe",
)

check(
  "restore is named from deleted_at clearing",
  summarizeChange(
    "docket_matters",
    "update",
    { case_number: "123/2026", matter_title: "Police v. Doe", deleted_at: "2026-09-01T00:00:00Z" },
    { case_number: "123/2026", matter_title: "Police v. Doe", deleted_at: null },
  ).title,
  "Restored from bin: 123/2026 · Police v. Doe",
)

check(
  "purge delete uses old_data as the subject",
  summarizeChange("docket_matters", "delete", { case_number: "123/2026", matter_title: "Police v. Doe" }, null).title,
  "Docket matter permanently deleted: 123/2026 · Police v. Doe",
)

check(
  "docket events are categorized separately from access",
  summarizeChange("docket_matters", "insert", null, { case_number: "1", matter_title: "A" }).category,
  "docket",
)

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
