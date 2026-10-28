/**
 * The plan half of deploy-db.yml (BE-03): asks the pinned Supabase CLI what
 * `supabase db push` would apply to a database, without applying anything.
 *
 *   node scripts/db-push-plan.mjs plan   <target flags>
 *       Writes the plan to the job summary ($GITHUB_STEP_SUMMARY) and as the
 *       step output `plan` ($GITHUB_OUTPUT), so the approver of the apply
 *       job reads it before approving.
 *
 *   DB_PUSH_PLAN='<plan output>' node scripts/db-push-plan.mjs verify <target flags>
 *       Exits 1 unless the database would still receive exactly that plan,
 *       so the apply job pushes what was approved or nothing.
 *
 * The target flags go to `supabase db push` unchanged: `--linked` in
 * deploy-db.yml, `--db-url <url>` against the local stack in migration-ci.yml.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The CLI version package.json pins, as an npx package spec. */
export function pinnedCli() {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
  return `supabase@${pkg.devDependencies.supabase}`;
}

/**
 * Reads the CLI's `--output-format json` result off its stdout. Refuses
 * anything that is not a dry run, so a CLI that ignored --dry-run is caught
 * rather than reported as a plan.
 */
export function parseDryRun(stdout) {
  const line = stdout
    .split("\n")
    .map((text) => text.trim())
    .findLast((text) => text.startsWith("{"));
  if (!line) throw new Error("supabase db push printed no JSON result");
  const result = JSON.parse(line);
  if (result.dryRun !== true) throw new Error("supabase db push did not report a dry run");
  const list = (key) => {
    const value = result[key] ?? [];
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      throw new Error(`supabase db push reported a malformed ${key} list`);
    }
    return value;
  };
  return { migrations: list("migrations"), seeds: list("seeds"), roles: list("roles") };
}

export function samePlan(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function renderSummary(plan, { sha = "", target = "" } = {}) {
  const lines = [`## Database plan${target ? `: ${target}` : ""}`, ""];
  if (sha) lines.push(`Commit \`${sha}\`.`, "");
  const empty = !plan.migrations.length && !plan.seeds.length && !plan.roles.length;
  if (empty) {
    lines.push("Up to date: `db push` would apply nothing.");
  } else {
    lines.push(
      `\`db push\` would apply ${plan.migrations.length} migration(s), in this order:`,
      "",
    );
    lines.push(...plan.migrations.map((file) => `1. \`${file}\``));
    for (const [key, label] of [
      ["seeds", "Seed files"],
      ["roles", "Role files"],
    ]) {
      if (plan[key].length) lines.push("", `${label}:`, ...plan[key].map((f) => `- \`${f}\``));
    }
  }
  lines.push(
    "",
    "The apply job checks the database still lacks exactly this list before it pushes.",
  );
  return `${lines.join("\n")}\n`;
}

function dryRun(targetFlags) {
  const run = spawnSync(
    "npx",
    ["--yes", pinnedCli(), "db", "push", "--dry-run", "--output-format", "json", ...targetFlags],
    { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  if (run.status !== 0) {
    process.stdout.write(run.stdout ?? "");
    throw new Error(`supabase db push --dry-run exited with ${run.status ?? run.signal}`);
  }
  return parseDryRun(run.stdout);
}

function main([mode, ...targetFlags]) {
  if (!["plan", "verify"].includes(mode) || !targetFlags.length) {
    console.error("usage: db-push-plan.mjs plan|verify <supabase db push target flags>");
    return 2;
  }
  const plan = dryRun(targetFlags);
  console.log(`Plan: ${JSON.stringify(plan)}`);
  if (mode === "plan") {
    const summary = renderSummary(plan, {
      sha: process.env.GITHUB_SHA,
      target: process.env.DB_PUSH_TARGET,
    });
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
    else console.log(summary);
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `plan=${JSON.stringify(plan)}\n`);
    }
    return 0;
  }
  const approved = JSON.parse(process.env.DB_PUSH_PLAN ?? "null");
  if (!approved || !samePlan(plan, approved)) {
    console.error(`::error::The database no longer matches the plan.`);
    console.error(`  planned: ${JSON.stringify(approved)}`);
    console.error(`  now:     ${JSON.stringify(plan)}`);
    console.error("Nothing was applied. Re-run the workflow to plan again.");
    return 1;
  }
  console.log("The database still lacks exactly the planned list.");
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  }
}
