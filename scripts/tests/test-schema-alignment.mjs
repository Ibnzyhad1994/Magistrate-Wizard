/**
 * Schema alignment between git migrations and hosted Supabase projects.
 *
 * Always (no secrets, no network):
 *   - every supabase/migrations/*.sql file has a unique 4-digit prefix
 *     (the 0140 collision that skipped docket workflow protocols)
 *   - frontend contracts such as outcome_adjourned still have an ADD COLUMN
 *     in some migration file (gaps like 0049 are allowed)
 *
 * Hosted (read-only, skipped unless CI or SCHEMA_ALIGN_LIVE=1, and then
 * only when credentials exist):
 *   - Management API history vs git, matching on the 4-digit name prefix
 *     (hosted rows are timestamp versions like 20260808…)
 *   - PostgREST OpenAPI column probes for contracts that git actually ships
 *   - production mismatches fail; preview mismatches warn unless
 *     SCHEMA_ALIGN_STRICT_PREVIEW=1
 *
 * Missing credentials skip live checks rather than failing the job.
 * This script never writes to a database.
 *
 *   npm run test:schema-alignment
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = "supabase/migrations";
const MANAGEMENT_API = "https://api.supabase.com/v1";
const LIVE_TIMEOUT_MS = 20_000;

const PROD_REF = process.env.SCHEMA_ALIGN_PROD_REF || "gipijpeahkznfwitjccy";
const PREVIEW_REF = process.env.SCHEMA_ALIGN_PREVIEW_REF || "kmfjejfsbtvbhvpoxvhb";
const PROD_URL_DEFAULT = `https://${PROD_REF}.supabase.co`;
const PREVIEW_URL_DEFAULT = `https://${PREVIEW_REF}.supabase.co`;

/** Columns the app writes that must be introduced by a migration in this tree. */
const CONTRACTS = [
  {
    table: "docket_matters",
    column: "outcome_adjourned",
    source: "src/lib/docket-protocols.ts",
    since: ["0140", "0146"],
  },
  {
    table: "docket_matters",
    column: "workflow_protocol",
    source: "src/lib/docket-protocols.ts",
    since: ["0140", "0146"],
  },
];

let failures = 0;
let warnings = 0;

function pass(label) {
  console.log(`PASS — ${label}`);
}

function fail(label, detail) {
  failures += 1;
  console.log(`FAIL — ${label}`);
  if (detail) console.log(`  ${detail}`);
}

function warn(label, detail) {
  warnings += 1;
  console.log(`WARN — ${label}`);
  if (detail) console.log(`  ${detail}`);
}

function skip(label) {
  console.log(`SKIP — ${label}`);
}

function envFlag(name) {
  const v = String(process.env[name] || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function envVal(name) {
  const v = String(process.env[name] || "").trim();
  return v || null;
}

function hostedUrl(url, ref) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return null;
    if (/localhost|127\.0\.0\.1/i.test(u.hostname)) return null;
    if (ref && !u.hostname.includes(ref)) return null;
    return `${u.origin}`;
  } catch {
    return null;
  }
}

function parseMigrationName(filename) {
  const m = /^(\d{4})_(.+)\.sql$/i.exec(filename);
  if (!m) return null;
  return { version: m[1], slug: m[2], filename };
}

function normalizeSlug(version, name) {
  let n = String(name ?? "").replace(/\.sql$/i, "");
  const prefix = `${version}_`;
  if (n.startsWith(prefix)) n = n.slice(prefix.length);
  return n;
}

function summarize(items, cap = 12) {
  if (items.length <= cap) return items.join(", ");
  return `${items.slice(0, cap).join(", ")} (+${items.length - cap} more)`;
}

/**
 * Hosted projects record CLI timestamp versions (20260808…) while git uses
 * 0001 / 0144 prefixes. Identity is the 4-digit prefix in the filename or
 * in the remote name, never the timestamp.
 */
function parseLiveRow(row) {
  const rawVersion = String(row.version ?? row.id ?? "").trim();
  const rawName = String(row.name ?? row.filename ?? "").replace(/\.sql$/i, "").trim();
  let prefix = null;
  let slug = rawName;
  const numbered = /^(\d{4})(?:[a-z])?_(.+)$/i.exec(rawName);
  if (numbered) {
    prefix = numbered[1];
    slug = numbered[2];
  } else if (/^\d{1,4}$/.test(rawVersion)) {
    prefix = rawVersion.padStart(4, "0");
    slug = normalizeSlug(prefix, rawName);
  }
  return { prefix, slug, rawVersion, rawName };
}

function previewIsSoft() {
  return !envFlag("SCHEMA_ALIGN_STRICT_PREVIEW");
}

function targetIssue(target, label, detail) {
  if (target.id === "preview" && previewIsSoft()) warn(label, detail);
  else fail(label, detail);
}

function versionCmp(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return String(a).localeCompare(String(b));
}

function tableProperties(spec, table) {
  return (
    spec?.components?.schemas?.[table]?.properties ??
    spec?.definitions?.[table]?.properties ??
    null
  );
}

async function fetchJson(url, headers) {
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(LIVE_TIMEOUT_MS),
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { ok: res.ok, status: res.status, body };
}

function listRepoMigrations() {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  const parsed = [];
  const unparsed = [];
  for (const filename of files) {
    const row = parseMigrationName(filename);
    if (row) parsed.push(row);
    else unparsed.push(filename);
  }
  parsed.sort((a, b) => versionCmp(a.version, b.version) || a.filename.localeCompare(b.filename));
  return { parsed, unparsed };
}

function checkRepo(parsed, unparsed) {
  console.log("\n== repo migrations ==");
  if (unparsed.length) {
    fail(
      "every migration filename is NNNN_description.sql",
      unparsed.join(", "),
    );
  } else {
    pass(`migration filenames match NNNN_description.sql (${parsed.length} files)`);
  }

  const byVersion = new Map();
  for (const row of parsed) {
    const list = byVersion.get(row.version) ?? [];
    list.push(row.filename);
    byVersion.set(row.version, list);
  }
  const dupes = [...byVersion.entries()].filter(([, files]) => files.length > 1);
  if (dupes.length) {
    for (const [version, files] of dupes) {
      fail(`unique prefix ${version}`, files.join(", "));
    }
  } else {
    pass("no duplicate migration version prefixes");
  }

  const numeric = parsed.map((row) => Number(row.version)).filter(Number.isFinite);
  const min = Math.min(...numeric);
  const max = Math.max(...numeric);
  const present = new Set(numeric);
  const gaps = [];
  for (let n = min; n <= max; n += 1) {
    if (!present.has(n)) gaps.push(String(n).padStart(4, "0"));
  }
  if (gaps.length) {
    console.log(`INFO — version gaps (allowed): ${gaps.join(", ")}`);
  } else {
    pass("no version gaps in the numbered range");
  }

  for (const contract of CONTRACTS) {
    const sqlHit = parsed.some((row) => {
      const sql = readFileSync(join(MIGRATIONS_DIR, row.filename), "utf8");
      return new RegExp(`\\b${contract.column}\\b`).test(sql);
    });
    if (!sqlHit) {
      fail(
        `migration SQL mentions ${contract.table}.${contract.column}`,
        `${contract.source} writes this column; no migration in ${MIGRATIONS_DIR} names it`,
      );
    } else {
      pass(`migration SQL mentions ${contract.table}.${contract.column}`);
    }

    if (contract.source) {
      let src = "";
      try {
        src = readFileSync(contract.source, "utf8");
      } catch {
        fail(`contract source exists (${contract.source})`);
        continue;
      }
      if (!src.includes(contract.column)) {
        warn(
          `${contract.source} no longer mentions ${contract.column}`,
          "drop the contract from this script if the column was intentionally removed",
        );
      }
    }
  }
}

function wantLive() {
  if (envFlag("SCHEMA_ALIGN_SKIP_LIVE")) return false;
  if (envFlag("SCHEMA_ALIGN_LIVE")) return true;
  return Boolean(process.env.GITHUB_ACTIONS);
}

function targets() {
  const prodUrl =
    hostedUrl(envVal("VITE_SUPABASE_URL"), PROD_REF) ||
    hostedUrl(envVal("SCHEMA_ALIGN_PROD_URL"), PROD_REF) ||
    PROD_URL_DEFAULT;
  const previewUrl =
    hostedUrl(envVal("SCHEMA_ALIGN_PREVIEW_URL"), PREVIEW_REF) || PREVIEW_URL_DEFAULT;
  return [
    {
      id: "prod",
      ref: PROD_REF,
      url: prodUrl,
      anon: envVal("VITE_SUPABASE_ANON_KEY") || envVal("SCHEMA_ALIGN_PROD_ANON_KEY"),
    },
    {
      id: "preview",
      ref: PREVIEW_REF,
      url: previewUrl,
      anon: envVal("SCHEMA_ALIGN_PREVIEW_ANON_KEY"),
    },
  ];
}

function asMigrationList(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.versions)) return body.versions;
  if (Array.isArray(body?.migrations)) return body.migrations;
  return null;
}

async function checkHistory(target, token, parsed) {
  const label = `${target.id} migration history`;
  const { ok, status, body } = await fetchJson(
    `${MANAGEMENT_API}/projects/${target.ref}/database/migrations`,
    { Authorization: `Bearer ${token}`, Accept: "application/json" },
  );
  if (status === 401 || status === 403) {
    skip(`${label} (management token not authorized, HTTP ${status})`);
    return;
  }
  if (!ok) {
    fail(label, `HTTP ${status}`);
    return;
  }
  const rows = asMigrationList(body);
  if (!rows) {
    fail(label, "response was not a migration list");
    return;
  }

  const live = rows.map(parseLiveRow);
  const gitMax = parsed.reduce(
    (max, row) => (versionCmp(row.version, max) > 0 ? row.version : max),
    parsed[0]?.version ?? "0000",
  );
  const gitByVersion = new Map(parsed.map((row) => [row.version, row]));
  const liveByPrefix = new Map();
  for (const row of live) {
    if (!row.prefix) continue;
    const list = liveByPrefix.get(row.prefix) ?? [];
    list.push(row);
    liveByPrefix.set(row.prefix, list);
  }

  const coversGit = (git) => {
    if ((liveByPrefix.get(git.version) ?? []).length) return true;
    return live.some((l) => {
      if (l.prefix && l.prefix !== git.version) return false;
      if (l.slug === git.slug) return true;
      if (l.rawName === `${git.version}_${git.slug}`) return true;
      return (
        git.slug.length >= 16 &&
        Boolean(l.slug) &&
        (l.slug.startsWith(git.slug) || git.slug.startsWith(l.slug))
      );
    });
  };

  const missing = [];
  for (const row of parsed) {
    if (!coversGit(row)) missing.push(row.filename);
  }
  if (missing.length) {
    targetIssue(
      target,
      `${target.id} has every git migration`,
      `hosted is behind: ${summarize(missing)}`,
    );
  } else {
    pass(`${target.id} has every git migration version`);
  }

  for (const row of parsed) {
    const remote = liveByPrefix.get(row.version);
    if (!remote?.length) continue;
    const slugs = new Set(remote.map((r) => r.slug).filter(Boolean));
    if (slugs.size && row.slug && !slugs.has(row.slug)) {
      targetIssue(
        target,
        `${target.id} ${row.version} name matches git`,
        `git=${row.slug} live=${summarize([...slugs])}`,
      );
    }
  }

  const extra = [];
  const extraAhead = [];
  for (const [prefix, remoteRows] of liveByPrefix) {
    if (gitByVersion.has(prefix)) continue;
    const names = remoteRows.map((r) => r.slug || prefix);
    const item = `${prefix} (${summarize(names, 4)})`;
    if (versionCmp(prefix, gitMax) > 0) extraAhead.push(item);
    else extra.push(item);
  }
  const unnumbered = live
    .filter((row) => !row.prefix && !parsed.some((g) => g.slug === row.slug))
    .map((row) => row.rawName || row.slug);
  if (extraAhead.length) {
    targetIssue(
      target,
      `${target.id} is not ahead of git`,
      `newer unknown versions: ${summarize(extraAhead)}`,
    );
  } else {
    pass(`${target.id} has no numbered versions newer than git ${gitMax}`);
  }
  if (extra.length) {
    warn(
      `${target.id} has historical numbered versions not in git (allowed)`,
      summarize(extra),
    );
  }
  if (unnumbered.length) {
    warn(
      `${target.id} has unnumbered extra migrations (allowed)`,
      summarize(unnumbered),
    );
  }
}

async function checkOpenApi(target, parsed) {
  const label = `${target.id} OpenAPI`;
  if (!target.anon) {
    skip(`${label} (no anon key)`);
    return;
  }
  const { ok, status, body } = await fetchJson(`${target.url}/rest/v1/`, {
    apikey: target.anon,
    Authorization: `Bearer ${target.anon}`,
    Accept: "application/openapi+json",
    "Accept-Profile": "public",
  });
  if (status === 401 || status === 403) {
    skip(`${label} (anon key not authorized, HTTP ${status})`);
    return;
  }
  if (!ok || !body || typeof body !== "object") {
    targetIssue(target, label, `HTTP ${status}`);
    return;
  }
  pass(`${label} reachable`);

  const gitVersions = new Set(parsed.map((row) => row.version));
  for (const contract of CONTRACTS) {
    if (!contract.since.some((version) => gitVersions.has(version))) {
      skip(`${target.id} ${contract.table}.${contract.column} (introducing migration not in this tree)`);
      continue;
    }
    const props = tableProperties(body, contract.table);
    if (!props) {
      targetIssue(
        target,
        `${target.id} schema cache has ${contract.table}`,
        "PostgREST OpenAPI omitted the table",
      );
      continue;
    }
    if (!(contract.column in props)) {
      targetIssue(
        target,
        `${target.id} ${contract.table}.${contract.column} in schema cache`,
        "column missing from PostgREST OpenAPI — hosted schema or cache is behind git",
      );
    } else {
      pass(`${target.id} ${contract.table}.${contract.column} is in schema cache`);
    }
  }
}

async function checkLive(parsed) {
  console.log("\n== hosted projects (read-only) ==");
  if (envFlag("SCHEMA_ALIGN_SKIP_LIVE")) {
    skip("hosted checks (SCHEMA_ALIGN_SKIP_LIVE)");
    return;
  }
  if (!wantLive()) {
    skip("hosted checks (set SCHEMA_ALIGN_LIVE=1 or run in GitHub Actions)");
    return;
  }

  const token = envVal("SUPABASE_ACCESS_TOKEN");
  const requireLive = envFlag("SCHEMA_ALIGN_REQUIRE_LIVE");
  let attempted = false;

  for (const target of targets()) {
    console.log(`\n-- ${target.id} (${target.ref}) --`);
    if (token) {
      attempted = true;
      await checkHistory(target, token, parsed);
    } else {
      skip(`${target.id} migration history (no SUPABASE_ACCESS_TOKEN)`);
    }
    if (target.anon) {
      attempted = true;
      await checkOpenApi(target, parsed);
    } else {
      skip(`${target.id} OpenAPI (no anon key)`);
    }
  }

  if (requireLive && !attempted) {
    fail(
      "live credentials present",
      "SCHEMA_ALIGN_REQUIRE_LIVE=1 but no SUPABASE_ACCESS_TOKEN or anon key was set",
    );
  } else if (!attempted) {
    skip("all hosted checks (no live credentials in the environment)");
  }
}

const { parsed, unparsed } = listRepoMigrations();
checkRepo(parsed, unparsed);
await checkLive(parsed);

console.log("");
if (failures) {
  console.log(`${failures} failure(s), ${warnings} warning(s)`);
  process.exit(1);
}
console.log(`All schema-alignment checks passed (${warnings} warning(s))`);
