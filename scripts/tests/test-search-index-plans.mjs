// @live-db  opens a real Supabase connection: `npm test` skips it, `npm run test:live` includes it
/**
 * Case Law and Docket search use their indexes (0171), on a realistically
 * sized library, as a signed-in magistrate.
 *
 *   BE-13  inside one transaction that is rolled back, seeds 50,000
 *          published Case Law rows and 20,000 Docket Matters (one active
 *          party each) in a fixture court, then, as the fixture magistrate:
 *          - the candidate query each search runs is served by Bitmap Index
 *            Scans on the full-text and trigram indexes, with no Seq Scan,
 *            in both the custom and the generic plan;
 *          - search_case_law, search_case_law_scoped, the court facet,
 *            search_docket_matters, list_docket_matters and global_search
 *            take at most a tenth of the time the 0166/0145 per-row
 *            predicate took on the same data;
 *          - every query matches exactly the rows the 0112/0145 predicate
 *            matched (typo, substring, citation, case number, party name,
 *            a literal "%");
 *          - a matching row the caller cannot read never comes back, even
 *            from the candidate functions called directly, and the Data API
 *            does not serve the `private` schema.
 *
 * Prints the before/after numbers (EXPLAIN ANALYZE, BUFFERS) for the PR.
 * Needs `psql` and the local stack (`npm run db:start`); nothing persists.
 *
 *   npm run test:search-index-plans
 */
import { appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { runSql, sections } from "../test-support/psql.mjs";
import { assertLocalSupabase } from "../test-support/assert-local-supabase.mjs";

const URL = process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:56321";
assertLocalSupabase(URL, "test-search-index-plans");
const ANON =
  process.env.VITE_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

const CASE_LAW_ROWS = 50_000;
const DOCKET_ROWS = 20_000;

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

const lit = (s) => `'${String(s).replaceAll("'", "''")}'`;
const likePattern = (q) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const magistrate = randomUUID();
const outsider = randomUUID();
const curator = randomUUID();
const district = randomUUID();
const court = randomUUID();
const otherCourt = randomUUID();
const claims = (uid) => JSON.stringify({ sub: uid, role: "authenticated" });

// Queries that each exercise one arm of the match.
const CASE_LAW_QUERIES = {
  typo: "Quilfeathre v Rexmoor",
  substring: "illfeath",
  citation: "FIXCIT 4242",
  fullText: "Rexmoor",
  literalPercent: "100% liable",
};
const DOCKET_QUERIES = {
  caseNumber: "FXDM-1234/",
  title: "Brackenwhistle",
  titleTypo: "Brakenwhistle",
  party: "Zebulon Quarrington",
  attorney: "Ottoline Varsk",
};

/** The `return query` statement of a candidate function, as deployed. */
function candidateQuery(prosrc) {
  const start = prosrc.indexOf("return query");
  const end = prosrc.lastIndexOf(";", prosrc.lastIndexOf("end;") - 1);
  if (start < 0 || end < start) throw new Error("candidate function has no return query");
  return prosrc
    .slice(start + "return query".length, end)
    .replace(/\bv_query\b/g, "$1")
    .replace(/\bv_pattern\b/g, "$2");
}

function walk(node, out = []) {
  out.push(node);
  for (const child of node.Plans ?? []) walk(child, out);
  return out;
}
function summarise(jsonText) {
  const [root] = JSON.parse(jsonText);
  const nodes = walk(root.Plan);
  return {
    ms: Number(root["Execution Time"].toFixed(2)),
    buffers: (root.Plan["Shared Hit Blocks"] ?? 0) + (root.Plan["Shared Read Blocks"] ?? 0),
    seqScans: nodes.filter((n) => n["Node Type"] === "Seq Scan").map((n) => n["Relation Name"]),
    indexes: [...new Set(nodes.map((n) => n["Index Name"]).filter(Boolean))].sort(),
  };
}

async function main() {
  // ---------- the Data API does not serve the private schema ----------
  for (const fn of ["case_law_search_hits", "docket_matter_search_hits"]) {
    const res = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        apikey: ANON,
        Authorization: `Bearer ${ANON}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_query: "a" }),
    });
    check(`BE-13 the Data API does not serve ${fn}`, res.ok, false);
  }

  const prosrc = sections(
    runSql(
      `\\echo @@case_law
select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'private' and p.proname = 'case_law_search_hits';
\\echo @@docket
select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'private' and p.proname = 'docket_matter_search_hits';`,
      "test-search-index-plans",
    ),
  );
  if (!prosrc.case_law || !prosrc.docket) {
    check("BE-13 the candidate functions exist (0171)", false, true);
    return;
  }

  const script = [];
  const echo = (label) => script.push(`\\echo @@${label}`);
  const explain = (label, sql) => {
    echo(label);
    script.push(`explain (analyze, buffers, format json) ${sql};`);
  };
  const idsOf = (label, sql) => {
    echo(label);
    script.push(
      `select count(*) || ':' || coalesce(md5(string_agg(id::text, ',' order by id)), '') from (${sql}) s;`,
    );
  };

  script.push(`begin;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token)
values
  ('00000000-0000-0000-0000-000000000000', ${lit(magistrate)}, 'authenticated', 'authenticated',
   'be13-magistrate-${magistrate.slice(0, 8)}@example.test', '', now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"BE13 Magistrate"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', ${lit(outsider)}, 'authenticated', 'authenticated',
   'be13-outsider-${outsider.slice(0, 8)}@example.test', '', now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"BE13 Outsider"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', ${lit(curator)}, 'authenticated', 'authenticated',
   'be13-curator-${curator.slice(0, 8)}@example.test', '', now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"BE13 Curator"}', now(), now(), '', '', '', '');
-- Only an admin may add canonical Case Law (case_law_ownership_guard).
update public.profiles set role = 'admin' where id = ${lit(curator)};
insert into public.magisterial_districts (id, name) values (${lit(district)}, 'BE13 District ${district.slice(0, 8)}');
insert into public.courts (id, name, jurisdiction, district_id, is_active) values
  (${lit(court)}, 'BE13 Court ${court.slice(0, 8)}', 'Test', ${lit(district)}, true),
  (${lit(otherCourt)}, 'BE13 Other Court ${otherCourt.slice(0, 8)}', 'Test', ${lit(district)}, true);
insert into public.magistrate_courts (profile_id, court_id) values
  (${lit(magistrate)}, ${lit(court)}), (${lit(outsider)}, ${lit(otherCourt)});

-- The library, added by the curator. The bulk rows skip the per-row audit
-- trigger when the role owns the table (rolled back anyway); otherwise they
-- simply go in with their triggers.
set local request.jwt.claims = ${lit(claims(curator))};
do $do$ begin alter table public.case_law disable trigger user;
exception when insufficient_privilege then null; end $do$;
insert into public.case_law (case_name, citation, court, jurisdiction, summary, review_status)
select
  initcap(substr(md5(g::text), 1, 9)) || ' v ' || initcap(substr(md5((g * 7)::text), 1, 9)),
  '[' || (1950 + g % 75) || '] FIXCIT ' || g,
  'Fixture Court of Appeal',
  'Fixture',
  'Appeal concerning ' || substr(md5((g * 3)::text), 1, 12) || ' and ' || substr(md5((g * 5)::text), 1, 12)
    || '. The court considered the ' || substr(md5((g * 11)::text), 1, 10) || ' principle at length.',
  'published'
from generate_series(1, ${CASE_LAW_ROWS}) g;
insert into public.case_law (case_name, citation, court, jurisdiction, summary, review_status, owner_id, is_discoverable)
values
  ('Quillfeather v Rexmoor', '[2021] FIXCIT 4242', 'Fixture Court of Appeal', 'Fixture',
   'Held 100% liable for the collapse.', 'published', null, false);
do $do$ begin alter table public.case_law enable trigger user;
exception when insufficient_privilege then null; end $do$;
-- Matches every query, but is another magistrate's private research (the
-- ownership guard stamps the owner from the session).
set local request.jwt.claims = ${lit(claims(outsider))};
insert into public.case_law (case_name, citation, court, jurisdiction, summary, owner_id, is_discoverable)
values ('Quillfeather v Rexmoor (private notes)', '[2021] FIXCIT 4242 PRIVATE', 'Fixture Court of Appeal',
  'Fixture', 'Held 100% liable, private.', ${lit(outsider)}, false);

set local request.jwt.claims = ${lit(claims(magistrate))};
insert into public.docket_matters (case_number, matter_title, charge_or_issue, court_id, district_id)
select
  'FXDM-' || g || '/2026',
  'Police v ' || initcap(substr(md5((g * 13)::text), 1, 8)) || ' ' || initcap(substr(md5((g * 17)::text), 1, 10)),
  'Charge ' || substr(md5((g * 19)::text), 1, 14),
  ${lit(court)},
  ${lit(district)}
from generate_series(1, ${DOCKET_ROWS}) g;
insert into public.docket_matters (case_number, matter_title, charge_or_issue, court_id, district_id)
values ('FXDM-TARGET/2026', 'Police v Brackenwhistle', 'Unlawful wounding', ${lit(court)}, ${lit(district)});
insert into public.docket_matter_parties (docket_matter_id, full_name, role, attorney_name)
select dm.id,
  initcap(substr(md5(dm.case_number), 1, 7)) || ' ' || initcap(substr(md5(dm.case_number || 'x'), 1, 9)),
  'accused',
  case when dm.case_number = 'FXDM-TARGET/2026' then 'Ottoline Varsk' end
from public.docket_matters dm
where dm.court_id = ${lit(court)};
insert into public.docket_matter_parties (docket_matter_id, full_name, role)
select id, 'Zebulon Quarrington', 'complainant'
from public.docket_matters where case_number = 'FXDM-TARGET/2026' and court_id = ${lit(court)};

set local request.jwt.claims = ${lit(claims(outsider))};
-- Matches the docket queries, in a court the magistrate does not sit in.
insert into public.docket_matters (case_number, matter_title, charge_or_issue, court_id, district_id)
values ('FXDM-1234/OTHER', 'Police v Brackenwhistle (other court)', 'Unlawful wounding', ${lit(otherCourt)}, ${lit(district)});

analyze public.case_law;
analyze public.docket_matters;
analyze public.docket_matter_parties;
set local request.jwt.claims = ${lit(claims(magistrate))};
set local pg_trgm.similarity_threshold = 0.3;
`);

  // ---------- the candidate queries, as the function owner runs them ----------
  for (const [name, src] of [
    ["case_law", prosrc.case_law],
    ["docket", prosrc.docket],
  ]) {
    script.push(`prepare ${name}_hits(text, text) as ${candidateQuery(src)};`);
    const q = name === "case_law" ? CASE_LAW_QUERIES.typo : DOCKET_QUERIES.title;
    for (const mode of ["custom", "generic"]) {
      script.push(`set local plan_cache_mode = force_${mode}_plan;`);
      explain(`plan:${name}:${mode}`, `execute ${name}_hits(${lit(q)}, ${lit(likePattern(q))})`);
    }
  }
  script.push(`reset plan_cache_mode;`);

  // ---------- as the signed-in magistrate ----------
  script.push(`set local role authenticated;`);

  for (const [key, q] of Object.entries(CASE_LAW_QUERIES)) {
    idsOf(
      `ids:case_law:${key}:old`,
      `select cl.id from public.case_law cl where public.case_law_matches_query(cl.case_name, cl.citation, cl.search_vector, ${lit(q)})`,
    );
    idsOf(
      `ids:case_law:${key}:new`,
      `select cl.id from private.case_law_search_hits(${lit(q)}) h join public.case_law cl on cl.id = h.id`,
    );
    idsOf(`ids:case_law:${key}:raw`, `select h.id from private.case_law_search_hits(${lit(q)}) h`);
  }
  for (const [key, q] of Object.entries(DOCKET_QUERIES)) {
    idsOf(
      `ids:docket:${key}:old`,
      `select dm.id from public.docket_matters dm where public.docket_matter_matches_query(dm.case_number, dm.matter_title, dm.charge_or_issue, dm.search_vector, dm.id, ${lit(q)})`,
    );
    idsOf(
      `ids:docket:${key}:new`,
      `select dm.id from private.docket_matter_search_hits(${lit(q)}) h join public.docket_matters dm on dm.id = h.id`,
    );
    idsOf(
      `ids:docket:${key}:raw`,
      `select h.id from private.docket_matter_search_hits(${lit(q)}) h`,
    );
  }

  const clq = lit(CASE_LAW_QUERIES.typo);
  const dq = lit(DOCKET_QUERIES.title);
  // Before: 0166's bodies, the per-row predicate, run as the same caller.
  explain(
    "rpc:search_case_law:old",
    `select cl.id, public.case_law_search_rank(cl.case_name, cl.search_vector, ${clq}) as rank,
       ts_headline('english', coalesce(cl.summary, cl.full_text, ''), websearch_to_tsquery('english', ${clq})) as headline
     from public.case_law cl
     where public.case_law_matches_query(cl.case_name, cl.citation, cl.search_vector, ${clq})
     order by 2 desc limit 20`,
  );
  explain(
    "rpc:search_docket_matters:old",
    `select dm.id, public.docket_matter_search_rank(dm.case_number, dm.matter_title, dm.search_vector, dm.id, ${dq}) as rank
     from public.docket_matters dm
     where dm.deleted_at is null
       and public.docket_matter_matches_query(dm.case_number, dm.matter_title, dm.charge_or_issue, dm.search_vector, dm.id, ${dq})
     order by 2 desc limit 20`,
  );
  // After: the real RPCs. Each is called eight times so the cached generic
  // plan inside the candidate functions is measured too (last call kept).
  const rpcs = {
    search_case_law: `select * from public.search_case_law(${clq}, 20)`,
    search_case_law_scoped: `select * from public.search_case_law_scoped(${clq}, 50)`,
    case_law_counts_by_court: `select * from public.case_law_counts_by_court(${clq})`,
    search_docket_matters: `select * from public.search_docket_matters(${dq}, 20)`,
    list_docket_matters: `select * from public.list_docket_matters(${dq}, 100)`,
    global_search: `select * from public.global_search(${clq}, 20)`,
  };
  for (const [name, sql] of Object.entries(rpcs)) {
    echo(`warm:${name}`);
    for (let i = 1; i < 8; i += 1) script.push(`select count(*) from (${sql}) warm;`);
    explain(`rpc:${name}:new`, sql);
  }
  // Correctness of the rows the RPCs return.
  echo("rows:search_case_law");
  script.push(
    `select case_name from public.search_case_law(${clq}, 20) order by rank desc limit 1;`,
  );
  echo("rows:search_docket_matters");
  script.push(
    `select string_agg(case_number, ',' order by case_number) from public.search_docket_matters(${dq}, 20);`,
  );
  echo("rows:list_docket_matters:party");
  script.push(
    `select string_agg(case_number, ',' order by case_number) from public.list_docket_matters(${lit(DOCKET_QUERIES.party)}, 100);`,
  );
  echo("rows:global_search");
  script.push(
    `select string_agg(entity_type || '=' || title, '|' order by entity_type, title) from public.global_search(${lit("Brackenwhistle")}, 20);`,
  );
  script.push("rollback;");

  const out = sections(runSql(script.join("\n"), "test-search-index-plans"));
  const plan = (label) => summarise(out[label]);

  // ---------- plans ----------
  for (const name of ["case_law", "docket"]) {
    for (const mode of ["custom", "generic"]) {
      const p = plan(`plan:${name}:${mode}`);
      console.log(`  ${name} candidate query, ${mode} plan:`, JSON.stringify(p));
      check(`BE-13 ${name} candidate query (${mode} plan) has no Seq Scan`, p.seqScans, []);
    }
  }
  const caseLawPlan = plan("plan:case_law:custom");
  check(
    "BE-13 case_law candidates come from the full-text and both trigram indexes",
    [
      "case_law_case_name_trgm_idx",
      "case_law_citation_trgm_idx",
      "case_law_search_vector_idx",
    ].every((i) => caseLawPlan.indexes.includes(i)),
    true,
  );
  const docketPlan = plan("plan:docket:custom");
  check(
    "BE-13 docket candidates come from the full-text, trigram and party indexes",
    [
      "docket_matters_search_vector_idx",
      "docket_matters_matter_title_trgm_idx",
      "docket_matters_case_number_trgm_idx",
      "docket_matters_charge_or_issue_trgm_idx",
      "docket_matter_parties_full_name_trgm_idx",
      "docket_matter_parties_attorney_name_trgm_idx",
    ].every((i) => docketPlan.indexes.includes(i)),
    true,
  );

  // ---------- same matches as before ----------
  for (const key of Object.keys(CASE_LAW_QUERIES)) {
    const old = out[`ids:case_law:${key}:old`];
    check(
      `BE-13 case_law "${key}" matches the same rows as 0166`,
      out[`ids:case_law:${key}:new`],
      old,
    );
    check(
      `BE-13 case_law "${key}" candidates hold no unreadable row`,
      out[`ids:case_law:${key}:raw`],
      old,
    );
    check(`BE-13 case_law "${key}" finds something`, old.startsWith("0:"), false);
  }
  for (const key of Object.keys(DOCKET_QUERIES)) {
    const old = out[`ids:docket:${key}:old`];
    check(`BE-13 docket "${key}" matches the same rows as 0145`, out[`ids:docket:${key}:new`], old);
    check(
      `BE-13 docket "${key}" candidates hold no unreadable matter`,
      out[`ids:docket:${key}:raw`],
      old,
    );
    check(`BE-13 docket "${key}" finds something`, old.startsWith("0:"), false);
  }
  check(
    "BE-13 search_case_law ranks the target first",
    out["rows:search_case_law"],
    "Quillfeather v Rexmoor",
  );
  check(
    "BE-13 search_docket_matters returns the target, not the other court's matter",
    out["rows:search_docket_matters"],
    "FXDM-TARGET/2026",
  );
  check(
    "BE-13 list_docket_matters finds a matter by its party's name",
    out["rows:list_docket_matters:party"],
    "FXDM-TARGET/2026",
  );
  check(
    "BE-13 global_search returns the readable docket matter only",
    out["rows:global_search"],
    "docket_matter=Police v Brackenwhistle",
  );

  // ---------- before and after ----------
  // Time is the measure: the old cost was CPU (the RLS policy and the match
  // function on every row), not I/O. Buffers are printed for the record; a
  // trigram common to every row (" v ") keeps the new case-law reads near a
  // thousand pages however small the result.
  // Also written to the CI job summary, which keeps the numbers of a passing
  // run (the runner prints a script's output only when it fails).
  const rows = [];
  const report = (label, p) => {
    console.log(
      `  ${label}: ${p.ms} ms, ${p.buffers} buffers, seq scans: ${p.seqScans.join(", ") || "none"}`,
    );
    rows.push(`| ${label} | ${p.ms} | ${p.buffers} | ${p.seqScans.join(", ") || "none"} |`);
  };
  for (const name of ["case_law", "docket"]) {
    for (const mode of ["custom", "generic"]) {
      report(`candidate query ${name}, ${mode} plan, as owner`, plan(`plan:${name}:${mode}`));
    }
  }
  console.log(
    `\n  ${CASE_LAW_ROWS} case_law rows, ${DOCKET_ROWS} docket matters, as a signed-in magistrate:`,
  );
  const baseline = {
    case_law: plan("rpc:search_case_law:old"),
    docket: plan("rpc:search_docket_matters:old"),
  };
  report("before (0166 predicate) search_case_law", baseline.case_law);
  report("before (0145 predicate) search_docket_matters", baseline.docket);
  for (const [name, domain] of [
    ["search_case_law", "case_law"],
    ["search_case_law_scoped", "case_law"],
    ["case_law_counts_by_court", "case_law"],
    ["search_docket_matters", "docket"],
    ["list_docket_matters", "docket"],
    ["global_search", "docket"],
  ]) {
    const after = plan(`rpc:${name}:new`);
    report(`after ${name}`, after);
    check(
      `BE-13 ${name} takes at most a tenth of the time the per-row ${domain} search took`,
      after.ms * 10 <= baseline[domain].ms,
      true,
    );
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      [
        `### BE-13 search plans: ${CASE_LAW_ROWS} case_law rows, ${DOCKET_ROWS} docket matters, signed-in magistrate`,
        "",
        "| Query | Execution ms | Shared buffers | Seq scans |",
        "| --- | --- | --- | --- |",
        ...rows,
        "",
      ].join("\n"),
    );
  }
}

try {
  await main();
} catch (error) {
  console.error(error);
  failures += 1;
}
if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll checks passed");
