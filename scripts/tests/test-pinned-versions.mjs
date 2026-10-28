/**
 * Edge Functions and the Supabase CLI run exact versions (BE-21), so a
 * supabase-js release or a CDN outage cannot change a function at its
 * next deploy, and CI runs the CLI the repository chose.
 *
 *   - every import in supabase/functions is relative or mapped by the
 *     function's deno.json to an exact npm:/jsr: version, never a URL or a
 *     range;
 *   - the functions' supabase-js is the app's locked supabase-js;
 *   - package.json pins the supabase CLI exactly, and every workflow that
 *     runs `npx supabase` either installs it with npm ci first or names the
 *     pinned version. deploy-db.yml is the exception: it deploys
 *     production and is changed only with the owner (BE-03).
 *
 *   npm run test:pinned-versions
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const EXACT = /^\d+\.\d+\.\d+$/;
const UNPINNED_DEPLOY_WORKFLOWS = new Set(["deploy-db.yml"]);

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

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

// ---------- Edge Function imports ----------
// Each function's deno.json maps bare specifiers to exact versions (the
// Supabase CLI bundles a function with its own deno.json); _shared/ is
// imported relatively and has no dependencies of its own.
const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8"));
const appSupabaseJs = lock.packages["node_modules/@supabase/supabase-js"]?.version;
const FUNCTIONS = join(ROOT, "supabase/functions");
const specifiersIn = (path) => {
  const text = readFileSync(path, "utf8");
  return [
    ...text.matchAll(/^\s*(?:import|export)\s[^;]*?\bfrom\s*["']([^"']+)["']/gm),
    ...text.matchAll(/^\s*import\s*["']([^"']+)["']/gm),
  ]
    .map((match) => match[1])
    .filter((specifier) => !specifier.startsWith("./") && !specifier.startsWith("../"));
};
const supabaseJsVersions = new Set();
for (const name of readdirSync(FUNCTIONS).filter((dir) =>
  statSync(join(FUNCTIONS, dir)).isDirectory(),
)) {
  const dir = join(FUNCTIONS, name);
  const sources = walk(dir).filter((path) => path.endsWith(".ts"));
  const used = [...new Set(sources.flatMap(specifiersIn))].sort();
  if (name === "_shared") {
    check("_shared/ imports nothing but relative files", used, []);
    continue;
  }
  const config = JSON.parse(readFileSync(join(dir, "deno.json"), "utf8"));
  const imports = config.imports ?? {};
  const loose = Object.entries(imports)
    .filter(([, target]) => {
      const pinned = /^(?:npm|jsr):(@?[^@]+)@([^/]+)$/.exec(target);
      return !pinned || !EXACT.test(pinned[2]);
    })
    .map(([key, target]) => `${key} -> ${target}`);
  check(`${name}: every deno.json import is an exact npm:/jsr: version`, loose, []);
  check(
    `${name}: every import is relative or mapped in its deno.json`,
    used.filter((specifier) => !(specifier in imports)),
    [],
  );
  const supabaseJs = /@(\d+\.\d+\.\d+)$/.exec(imports["@supabase/supabase-js"] ?? "")?.[1];
  if (supabaseJs) supabaseJsVersions.add(supabaseJs);
}
check(
  "the Edge Functions use the app's locked supabase-js",
  [...supabaseJsVersions],
  [appSupabaseJs],
);

// ---------- the Supabase CLI ----------
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const cli = pkg.devDependencies?.supabase;
check("package.json pins the supabase CLI exactly", EXACT.test(cli ?? ""), true);
check(
  "the lockfile resolves the pinned CLI",
  !!cli && lock.packages["node_modules/supabase"]?.version === cli,
  true,
);

const workflowsDir = join(ROOT, ".github/workflows");
for (const name of readdirSync(workflowsDir).filter((file) => file.endsWith(".yml"))) {
  if (UNPINNED_DEPLOY_WORKFLOWS.has(name)) continue;
  const text = readFileSync(join(workflowsDir, name), "utf8");
  const firstCli = text.search(/npx\s+(--yes\s+)?(supabase\b|"\$SUPABASE_CLI")/);
  if (firstCli === -1) continue;
  const installsFirst = text.slice(0, firstCli).includes("npm ci");
  const namesPinned = !/npx\s+(--yes\s+)?supabase\b/.test(text) && text.includes("$SUPABASE_CLI");
  check(`${name} runs the pinned supabase CLI`, installsFirst || namesPinned, true);
}

{
  const text = readFileSync(join(workflowsDir, "edge-functions.yml"), "utf8");
  const deno = /deno-version:\s*([^\s]+)/.exec(text)?.[1] ?? "";
  check("the Edge Functions workflow pins Deno exactly", EXACT.test(deno), true);
}

console.log(failures > 0 ? `\n${failures} failure(s).` : "\nAll pinned-version tests passed.");
process.exit(failures > 0 ? 1 : 0);
