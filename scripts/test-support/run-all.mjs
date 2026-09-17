/**
 * Script-test runner behind `npm test`.
 *
 * Discovers every `scripts/tests/test-*.mjs` (plus the pentest XSS probes and
 * the propose-tags comparison, which predate the naming convention) and runs
 * each one in its own Node process with the `@/` alias loader registered,
 * exactly what the per-script npm aliases do, minus the need to add an alias
 * and a CI line for every new file.
 *
 * Markers (anywhere in the first 20 lines of a script):
 *   // @live-db   opens a real Supabase connection: skipped unless --live
 *   // @slow      long-running / "brutal" variant:  skipped unless --slow
 *
 * Usage:
 *   node scripts/test-support/run-all.mjs [--live] [--slow] [--filter <substr>]
 *                                         [--jobs <n>] [--verbose] [--list]
 *                                         [--timeout-ms <n>]
 *
 * Exit code is non-zero when any selected script fails or times out, or when
 * the selection is empty (a typo in --filter must not look like a green run).
 */
import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const TESTS_DIR = path.join("scripts", "tests");
const REGISTER = "./scripts/test-support/register.mjs";
const EXTRA_FILES = ["pentest-xss-probes.mjs", "compare-propose-tags-before-after.mjs"];
const MARKER_LINES = 20;
const DEFAULT_TIMEOUT_MS = 15 * 60_000;

function parseArgs(argv) {
  const opts = {
    live: false,
    slow: false,
    filter: [],
    jobs: 1,
    verbose: false,
    list: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--live") opts.live = true;
    else if (arg === "--slow") opts.slow = true;
    else if (arg === "--verbose") opts.verbose = true;
    else if (arg === "--list") opts.list = true;
    else if (arg === "--filter") opts.filter.push(String(argv[++i] ?? ""));
    else if (arg.startsWith("--filter=")) opts.filter.push(arg.slice("--filter=".length));
    else if (arg === "--jobs") opts.jobs = Math.max(1, Number(argv[++i]) || 1);
    else if (arg.startsWith("--jobs="))
      opts.jobs = Math.max(1, Number(arg.slice("--jobs=".length)) || 1);
    else if (arg === "--timeout-ms") opts.timeoutMs = Number(argv[++i]) || DEFAULT_TIMEOUT_MS;
    else if (arg.startsWith("--timeout-ms=")) {
      opts.timeoutMs = Number(arg.slice("--timeout-ms=".length)) || DEFAULT_TIMEOUT_MS;
    } else if (arg === "--help" || arg === "-h") {
      console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]);
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return opts;
}

function markersOf(file) {
  const head = readFileSync(path.join(ROOT, TESTS_DIR, file), "utf8")
    .split(/\r?\n/, MARKER_LINES)
    .join("\n");
  return {
    live: /^\s*\/\/\s*@live-db\b/m.test(head),
    slow: /^\s*\/\/\s*@slow\b/m.test(head),
  };
}

function discover() {
  return readdirSync(path.join(ROOT, TESTS_DIR))
    .filter((name) => /^test-.*\.mjs$/.test(name) || EXTRA_FILES.includes(name))
    .sort()
    .map((name) => ({ name, ...markersOf(name) }));
}

function runOne(name, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const chunks = [];
    const child = spawn(process.execPath, ["--import", REGISTER, path.join(TESTS_DIR, name)], {
      cwd: ROOT,
      env: { ...process.env, FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => chunks.push(chunk));
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        name,
        ok: code === 0 && !timedOut,
        code,
        signal,
        timedOut,
        ms: Date.now() - started,
        output: Buffer.concat(chunks).toString("utf8"),
      });
    });
  });
}

async function runPool(items, jobs, worker) {
  const results = [];
  let next = 0;
  const lanes = Array.from({ length: Math.min(jobs, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      results.push(await worker(item));
    }
  });
  await Promise.all(lanes);
  return results;
}

function fmt(ms) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const all = discover();
  const matches = (name) => opts.filter.length === 0 || opts.filter.some((f) => name.includes(f));
  const skippedLive = [];
  const skippedSlow = [];
  const selected = [];
  for (const script of all) {
    if (!matches(script.name)) continue;
    if (script.live && !opts.live) {
      skippedLive.push(script.name);
      continue;
    }
    if (script.slow && !opts.slow) {
      skippedSlow.push(script.name);
      continue;
    }
    selected.push(script);
  }

  if (opts.list) {
    for (const s of all) {
      console.log(`${s.live ? "live " : "     "}${s.slow ? "slow " : "     "}${s.name}`);
    }
    return 0;
  }

  const flags = [
    `jobs=${opts.jobs}`,
    opts.live ? "live" : "",
    opts.slow ? "slow" : "",
    opts.filter.length ? `filter=${opts.filter.join(",")}` : "",
  ].filter(Boolean);
  console.log(`Discovered ${all.length} scripts; running ${selected.length} (${flags.join(", ")})`);
  if (skippedLive.length) {
    console.log(
      `Skipping ${skippedLive.length} @live-db script(s) (pass --live): ${skippedLive.join(", ")}`,
    );
  }
  if (skippedSlow.length) {
    console.log(
      `Skipping ${skippedSlow.length} @slow script(s) (pass --slow): ${skippedSlow.join(", ")}`,
    );
  }
  if (selected.length === 0) {
    console.error("No scripts selected.");
    return 1;
  }
  console.log("");

  const results = await runPool(selected, opts.jobs, async (script) => {
    console.log(`RUN   ${script.name}`);
    const result = await runOne(script.name, opts.timeoutMs);
    const status = result.ok ? "PASS " : result.timedOut ? "TIME " : "FAIL ";
    const detail = result.ok
      ? ""
      : result.timedOut
        ? ", timed out"
        : `, exit ${result.code ?? result.signal}`;
    console.log(`${status} ${result.name} (${fmt(result.ms)}${detail})`);
    if (!result.ok || opts.verbose) {
      const body = result.output.trimEnd();
      if (body)
        console.log(
          body
            .split("\n")
            .map((line) => `      ${line}`)
            .join("\n"),
        );
    }
    return result;
  });

  const failed = results.filter((r) => !r.ok);
  const totalMs = results.reduce((sum, r) => sum + r.ms, 0);
  console.log("");
  console.log(
    `${results.length - failed.length}/${results.length} passed in ${fmt(totalMs)} of script time`,
  );
  if (skippedLive.length || skippedSlow.length) {
    console.log(`skipped: ${skippedLive.length} live, ${skippedSlow.length} slow`);
  }
  if (failed.length) {
    console.log(`FAILED: ${failed.map((r) => r.name).join(", ")}`);
    return 1;
  }
  console.log("ALL PASS");
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
