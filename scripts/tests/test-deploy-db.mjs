/**
 * deploy-db.yml shows its plan before anyone approves it, and applies that
 * plan or nothing (BE-03):
 *
 *   - scripts/db-push-plan.mjs reads the CLI's dry-run result, refuses
 *     anything that is not a dry run, renders the job summary and compares
 *     plans exactly;
 *   - the workflow never starts on its own (no push trigger), plans in the
 *     reviewer-free `production-plan` environment and applies in
 *     `production`, after the plan and only after verifying it;
 *   - the release (develop-ci-automerge.yml) runs it before it moves main,
 *     so the frontend Vercel builds from main never goes live ahead of its
 *     schema.
 *
 * The plan and verify steps also run against the local stack in
 * migration-ci.yml.
 *
 *   npm run test:deploy-db
 */
import { readFileSync } from "node:fs";
import { parseDryRun, pinnedCli, renderSummary, samePlan } from "../db-push-plan.mjs";

let failures = 0;
function check(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} - ${label}`);
  if (!pass) {
    console.log("  expected:", JSON.stringify(expected));
    console.log("  actual:  ", JSON.stringify(actual));
    failures += 1;
  }
}
const throws = (fn) => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};

// ---------- the plan script ----------
check(
  "the plan script runs the CLI version package.json pins",
  pinnedCli(),
  `supabase@${JSON.parse(readFileSync("package.json", "utf8")).devDependencies.supabase}`,
);

const pending = {
  upToDate: false,
  dryRun: true,
  migrations: ["0181_export_audit_log.sql", "0190_list_keyset_indexes.sql"],
  seeds: [],
  roles: [],
  message: "Finished supabase db push.",
};
const upToDate = { ...pending, upToDate: true, migrations: [], message: "x" };
const planOf = (result) => ({
  migrations: result.migrations,
  seeds: result.seeds,
  roles: result.roles,
});

check(
  "a pending dry run parses to its migration list",
  parseDryRun(`${JSON.stringify(pending)}\n`),
  planOf(pending),
);
check("an up-to-date dry run parses to an empty plan", parseDryRun(JSON.stringify(upToDate)), {
  migrations: [],
  seeds: [],
  roles: [],
});
check(
  "the last JSON line wins over stray stdout text",
  parseDryRun(`Warning: something\n{"dryRun":true,"migrations":["a.sql"]}\n`),
  { migrations: ["a.sql"], seeds: [], roles: [] },
);
check(
  "a result that is not a dry run is refused",
  throws(() => parseDryRun(JSON.stringify({ ...pending, dryRun: false }))),
  true,
);
check(
  "no JSON result is refused",
  throws(() => parseDryRun("Remote database is up to date.\n")),
  true,
);
check(
  "a malformed migration list is refused",
  throws(() => parseDryRun(JSON.stringify({ dryRun: true, migrations: "a.sql" }))),
  true,
);

check("an identical plan matches", samePlan(planOf(pending), planOf(pending)), true);
check(
  "a plan with one migration more does not match",
  samePlan(planOf(pending), { ...planOf(pending), migrations: [...pending.migrations, "x.sql"] }),
  false,
);
check(
  "the same migrations in another order do not match",
  samePlan(planOf(pending), { ...planOf(pending), migrations: [...pending.migrations].reverse() }),
  false,
);

const summary = renderSummary(planOf(pending), { sha: "abc1234", target: "production" });
check("the summary names the target", summary.includes("## Database plan: production"), true);
check("the summary names the commit", summary.includes("`abc1234`"), true);
check(
  "the summary lists every migration in order",
  summary.indexOf("0181_export_audit_log.sql") < summary.indexOf("0190_list_keyset_indexes.sql") &&
    summary.includes("would apply 2 migration(s)"),
  true,
);
check(
  "an empty plan says the target is up to date",
  renderSummary(planOf(upToDate)).includes("Up to date"),
  true,
);

// ---------- the workflow ----------
const workflow = readFileSync(".github/workflows/deploy-db.yml", "utf8");
const jobsAt = workflow.indexOf("\njobs:\n");
const onAt = workflow.indexOf("\non:\n") + 1;
const triggers = workflow.slice(onAt, onAt + 1 + workflow.slice(onAt + 1).search(/\n[a-z]/));
const job = (name) => {
  const start = workflow.indexOf(`\n  ${name}:\n`, jobsAt);
  const next = workflow.slice(start + 1).search(/\n {2}[a-z][\w-]*:\n/);
  return next === -1 ? workflow.slice(start) : workflow.slice(start, start + 1 + next);
};
const plan = job("plan");
const apply = job("apply");

check(
  "deploy-db has no automatic trigger",
  [...triggers.matchAll(/^ {2}([a-z_]+):/gm)].map((match) => match[1]),
  ["workflow_dispatch", "workflow_call"],
);
check(
  "the plan job runs in the reviewer-free production-plan environment",
  /environment:\s*\n\s*name: production-plan\n/.test(plan),
  true,
);
check(
  "the plan job writes the plan to the job summary and its output",
  plan.includes("node scripts/db-push-plan.mjs plan --linked") &&
    plan.includes("plan: ${{ steps.plan.outputs.plan }}"),
  true,
);
check("the plan job never pushes", plan.includes('"$SUPABASE_CLI" db push'), false);
check(
  "the apply job runs in the production environment, after the plan",
  /environment:\s*\n\s*name: production\n/.test(apply) && apply.includes("needs: plan"),
  true,
);
check(
  "the apply job runs only when asked to, by hand from main or in the release on develop",
  apply.includes("(inputs.apply && github.ref == 'refs/heads/main') ||") &&
    apply.includes("(inputs.release && github.ref == 'refs/heads/develop')"),
  true,
);
const verifyAt = apply.indexOf("node scripts/db-push-plan.mjs verify --linked");
const pushAt = apply.indexOf('"$SUPABASE_CLI" db push --linked');
check(
  "the apply job verifies the approved plan before it pushes",
  verifyAt !== -1 &&
    pushAt > verifyAt &&
    apply.includes("DB_PUSH_PLAN: ${{ needs.plan.outputs.plan }}"),
  true,
);

// ---------- the release orders the frontend after the database ----------
const release = readFileSync(".github/workflows/develop-ci-automerge.yml", "utf8");
const releaseJob = (name) => {
  const start = release.indexOf(`\n  ${name}:\n`);
  const next = release.slice(start + 1).search(/\n {2}[a-z][\w-]*:\n/);
  return next === -1 ? release.slice(start) : release.slice(start, start + 1 + next);
};
const database = releaseJob("database");
check(
  "the release applies the database through deploy-db.yml",
  database.includes("uses: ./.github/workflows/deploy-db.yml") &&
    /with:\s*\n\s*release: true\n/.test(database),
  true,
);
check(
  "the release runs the database only when dispatched on develop",
  database.includes(
    "if: github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/develop'",
  ),
  true,
);
check(
  "main (the production frontend) moves only after the database",
  /\n {4}needs: \[[^\]]*\bdatabase\b[^\]]*\]/.test(releaseJob("merge-to-main")),
  true,
);

console.log(failures > 0 ? `\n${failures} failure(s).` : "\nAll deploy-db tests passed.");
process.exit(failures > 0 ? 1 : 0);
