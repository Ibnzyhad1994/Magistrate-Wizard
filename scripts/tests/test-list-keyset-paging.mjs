// @live-db  opens a real Supabase connection: `npm test` skips it, `npm run test:live` includes it
/**
 * The six capped lists page through every row (BE-15, 0190), on a real
 * database, through the Data API, as real signed-in users.
 *
 * Seeds more rows than each list's old cap: 350 Case Law (cap 300), 550
 * Legislation (500), 350 Bench Notes (300), 250 Judgments (200), 450
 * dashboard appearances (400) and 250 import jobs (200), with sort-key ties
 * across page boundaries, titles full of PostgREST syntax, untimed
 * appearances, and rows each list must leave out (draft and superseded
 * library rows, a binned matter's appearances). Then, for each list:
 *
 *   - pages with the hook's own fetcher and next-page rule, the exact calls
 *     useInfiniteQuery makes, until the list says it is complete;
 *   - asserts the pages hold every row the caller may see exactly once, in
 *     the database's own order for the sort key (read with psql as the same
 *     user, so RLS and collation match), took more than one page, and that
 *     the first page's total is that row count.
 *
 * Then, in a transaction that is rolled back, adds 20,000 rows per table,
 * analyses, and asserts the first page and a later page of each list use
 * the list's 0190 index (EXPLAIN as the signed-in user, RLS applied).
 *
 * Needs `psql` and the local stack (`npm run db:start`). Fixtures are
 * disposable users and rows, removed at the end.
 *
 *   npm run test:list-keyset-paging
 */
import { createClient } from "@supabase/supabase-js";
import { assertLocalSupabase } from "../test-support/assert-local-supabase.mjs";
import { runSql, sections } from "../test-support/psql.mjs";
import { nextKeysetCursor } from "@/lib/keyset-pagination";
import { fetchCaseLawListPage } from "@/hooks/case-law/use-case-law";
import { fetchStatutesPage, STATUTES_LIST_PAGE } from "@/hooks/legislation/use-legislation";
import { fetchBenchNotesPage } from "@/hooks/bench-notes/use-bench-notes";
import { fetchJudgmentsPage } from "@/hooks/judgments/use-judgments";
import { DASHBOARD_EVENT_PULSE_PAGE, fetchDashboardEventPulsePage } from "@/hooks/use-dashboard";
import { fetchImportJobsPage } from "@/hooks/legal-library/use-import-jobs";

const URL_ = process.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:56321";
const ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

assertLocalSupabase(URL_, "test:list-keyset-paging");

let failures = 0;
function check(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} - ${label}`);
  if (!pass) {
    console.log("  expected:", JSON.stringify(expected).slice(0, 400));
    console.log("  actual:  ", JSON.stringify(actual).slice(0, 400));
    failures += 1;
  }
}

const service = createClient(URL_, SERVICE_KEY, { auth: { persistSession: false } });
const tag = `be15${Date.now().toString(36)}`;
const PASSWORD = "Test-Password-123!";
// The dashboard window the fixtures sit in (104 days, like the dashboard's).
const FROM = "2026-01-01";
const TO = "2026-04-14";

const created = { users: [] };

async function createUser(name) {
  const { data, error } = await service.auth.admin.createUser({
    email: `${tag}-${name}@example.test`,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: `BE15 ${name}` },
  });
  if (error) throw error;
  created.users.push(data.user.id);
  return data.user;
}

async function signIn(user) {
  const client = createClient(URL_, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email: user.email, password: PASSWORD });
  if (error) throw error;
  return client;
}

const claims = (id) => JSON.stringify({ sub: id, role: "authenticated" });

/** Pages exactly as useKeysetList does: initial cursor null, then nextKeysetCursor. */
async function pageAll(fetchPage) {
  const pages = [];
  let cursor = null;
  for (;;) {
    pages.push(await fetchPage(cursor));
    cursor = nextKeysetCursor(pages);
    if (!cursor) return pages;
    if (pages.length > 500) throw new Error("Paging did not finish after 500 pages.");
  }
}

function checkList(label, pages, expectedIds, { minPages = 2 } = {}) {
  const ids = pages.flatMap((page) => page.rows.map((row) => row.id));
  check(`${label}: took more than one page`, pages.length >= minPages, true);
  check(`${label}: no row repeats across pages`, new Set(ids).size, ids.length);
  check(`${label}: every visible row, in the database's order`, ids, expectedIds);
  check(`${label}: first page's total is the row count`, pages[0].totalCount, expectedIds.length);
  return ids;
}

async function main() {
  const admin = await createUser("admin");
  const magistrate = await createUser("magistrate");
  const { error: roleError } = await service
    .from("profiles")
    .update({ role: "admin" })
    .eq("id", admin.id);
  if (roleError) throw roleError;

  // --- fixtures (committed, so the Data API sees them) --------------------
  const seed = `begin;
insert into public.magisterial_districts (id, name)
values (gen_random_uuid(), 'BE15 District ${tag}');
insert into public.courts (name, jurisdiction, district_id, is_active)
select 'BE15 Court ${tag}', 'Test', id, true from public.magisterial_districts
where name = 'BE15 District ${tag}';
insert into public.magistrate_courts (profile_id, court_id)
select '${magistrate.id}', id from public.courts where name = 'BE15 Court ${tag}';

-- Library and import jobs, added by the admin. Six updated_at values with
-- microsecond parts, so ties straddle every page boundary.
set local request.jwt.claims = '${claims(admin.id)}';
insert into public.case_law (case_name, citation, court, jurisdiction, review_status, updated_at)
select '${tag} v Crown ' || g, '[2025] ${tag} ' || g, 'Fixture Court', 'Fixture',
  case when g <= 350 then 'published' else 'draft' end,
  timestamptz '2025-06-01 12:00:00.000001+00' + (g % 6) * interval '1.000001 second'
from generate_series(1, 390) g;

insert into public.statutes (code, title, jurisdiction, review_status, is_current_version)
select '${tag}-' || g,
  (array['Act, "Quoted" (Cap. 1)', 'Back\\slash Act', 'Ünïcode Act', 'Act. No: 3'])[1 + g % 4]
    || case when g % 5 = 0 then '' else ' ' || (g % 9)::text end,
  'Fixture',
  case when g between 551 and 575 then 'draft' else 'published' end,
  g <= 575
from generate_series(1, 600) g;

insert into public.import_jobs (content_type, created_by, created_at)
select 'case_law', '${admin.id}',
  timestamptz '2025-06-01 12:00:00.000001+00' + (g % 6) * interval '1.000001 second'
from generate_series(1, 250) g;

-- Judgments, Bench Notes and appearances, by the magistrate.
set local request.jwt.claims = '${claims(magistrate.id)}';
insert into public.judgments (title, updated_at)
select '${tag} judgment ' || g,
  timestamptz '2025-06-01 12:00:00.000001+00' + (g % 6) * interval '1.000001 second'
from generate_series(1, 250) g;

insert into public.bench_notes (title, entity_type, entity_id, updated_at)
select '${tag} note ' || g, 'judgment',
  (select id from public.judgments where title = '${tag} judgment 1'),
  timestamptz '2025-06-01 12:00:00.000001+00' + (g % 6) * interval '1.000001 second'
from generate_series(1, 350) g;

insert into public.docket_matters (case_number, matter_title, court_id, district_id)
select n || '/2026', 'BE15 matter ${tag} ' || n, c.id, c.district_id
from public.courts c, (values ('BE15-1'), ('BE15-2')) v(n)
where c.name = 'BE15 Court ${tag}';

-- Five days, a third untimed, four times otherwise: ties everywhere.
insert into public.docket_events (docket_matter_id, scheduled_date, scheduled_time)
select m.id, date '2026-01-05' + (g % 5),
  case when g % 3 = 0 then null else time '09:00' + (g % 4) * interval '30 minutes' end
from public.docket_matters m, generate_series(1, 450) g
where m.matter_title = 'BE15 matter ${tag} BE15-1';
insert into public.docket_events (docket_matter_id, scheduled_date, scheduled_time)
select m.id, date '2026-01-05' + (g % 5), null
from public.docket_matters m, generate_series(1, 20) g
where m.matter_title = 'BE15 matter ${tag} BE15-2';
-- The second matter goes to the bin: its appearances leave the dashboard.
update public.docket_matters set deleted_at = now(), deleted_by = '${magistrate.id}'
where matter_title = 'BE15 matter ${tag} BE15-2';
commit;
`;
  runSql(seed, "test-list-keyset-paging");

  // --- the database's own order, read as each user with RLS ---------------
  const asUser = (id, body) => `begin;
set local role authenticated;
set local request.jwt.claims = '${claims(id)}';
${body}
rollback;
`;
  const ids = (label, alias, fromWhere, orderBy) => `\\echo @@${label}
select coalesce(string_agg(${alias}.id::text, ',' order by ${orderBy}), '') from ${fromWhere};`;
  const oracle = sections(
    runSql(
      asUser(
        admin.id,
        [
          ids(
            "case_law",
            "c",
            "public.case_law c where c.review_status = 'published'",
            "c.updated_at desc, c.id desc",
          ),
          ids(
            "statutes",
            "s",
            "public.statutes s where s.review_status = 'published' and s.is_current_version = true",
            "s.title, s.id",
          ),
          ids("import_jobs", "j", "public.import_jobs j", "j.created_at desc, j.id desc"),
          `\\echo @@case_law_fixtures
select count(*) from public.case_law where case_name like '${tag} v Crown %' and review_status = 'published';`,
        ].join("\n"),
      ) +
        asUser(
          magistrate.id,
          [
            ids("judgments", "j", "public.judgments j", "j.updated_at desc, j.id desc"),
            ids("bench_notes", "n", "public.bench_notes n", "n.updated_at desc, n.id desc"),
            ids(
              "events",
              "e",
              `public.docket_events e
               join public.docket_matters m on m.id = e.docket_matter_id and m.deleted_at is null
               where e.scheduled_date between '${FROM}' and '${TO}'`,
              "e.scheduled_date, e.scheduled_time nulls first, e.id",
            ),
          ].join("\n"),
        ),
      "test-list-keyset-paging",
    ),
  );
  const split = (text) => (text ? text.split(",") : []);

  const adminClient = await signIn(admin);
  const magistrateClient = await signIn(magistrate);

  const caseLaw = checkList(
    "Case Law (cap 300)",
    await pageAll((cursor) => fetchCaseLawListPage(adminClient, cursor)),
    split(oracle.case_law),
  );
  check("Case Law: all 350 published fixtures are visible", oracle.case_law_fixtures, "350");
  const { data: drafts } = await service
    .from("case_law")
    .select("id")
    .like("case_name", `${tag} v Crown %`)
    .eq("review_status", "draft");
  check(
    "Case Law: no draft is listed",
    (drafts ?? []).filter((row) => caseLaw.includes(row.id)).length,
    0,
  );

  const statutePages = await pageAll((cursor) => fetchStatutesPage(adminClient, cursor));
  const statutes = checkList("Legislation (cap 500)", statutePages, split(oracle.statutes));
  const { data: hidden } = await service
    .from("statutes")
    .select("id")
    .like("code", `${tag}-%`)
    .or("review_status.eq.draft,is_current_version.eq.false");
  check("Legislation: 50 draft or superseded fixtures exist", (hidden ?? []).length, 50);
  check(
    "Legislation: no draft or superseded Act is listed",
    (hidden ?? []).filter((row) => statutes.includes(row.id)).length,
    0,
  );
  check(
    "Legislation: titles with commas, quotes, parentheses and backslashes came back intact",
    statutePages
      .flatMap((page) => page.rows)
      .some((row) => row.title.startsWith('Act, "Quoted" (Cap. 1)')) &&
      statutePages.flatMap((page) => page.rows).some((row) => row.title.startsWith("Back\\slash")),
    true,
  );

  // Pages of 7 put a boundary on every title shape, so the cursor itself
  // carries commas, quotes, parentheses, dots, colons and backslashes.
  checkList(
    "Legislation in pages of 7 (cursor quoting)",
    await pageAll((cursor) =>
      fetchStatutesPage(adminClient, cursor, { ...STATUTES_LIST_PAGE, pageSize: 7 }),
    ),
    split(oracle.statutes),
  );

  checkList(
    "Import jobs (cap 200)",
    await pageAll((cursor) => fetchImportJobsPage(adminClient, cursor)),
    split(oracle.import_jobs),
  );
  checkList(
    "Judgments (cap 200)",
    await pageAll((cursor) => fetchJudgmentsPage(magistrateClient, cursor)),
    split(oracle.judgments),
  );
  checkList(
    "Bench Notes (cap 300)",
    await pageAll((cursor) => fetchBenchNotesPage(magistrateClient, cursor)),
    split(oracle.bench_notes),
  );
  const eventPages = await pageAll((cursor) =>
    fetchDashboardEventPulsePage(magistrateClient, FROM, TO, cursor),
  );
  const events = checkList("Dashboard appearances (cap 400)", eventPages, split(oracle.events));
  check("Dashboard: the 450 live appearances, none of the binned matter's", events.length, 450);

  // Pages of 7 put boundaries on untimed appearances (the nulls-first
  // branch of the cursor) and inside time ties.
  const smallEventPages = await pageAll((cursor) =>
    fetchDashboardEventPulsePage(magistrateClient, FROM, TO, cursor, {
      ...DASHBOARD_EVENT_PULSE_PAGE,
      pageSize: 7,
    }),
  );
  checkList("Dashboard appearances in pages of 7", smallEventPages, split(oracle.events));
  check(
    "Dashboard: some page in that pass ended on an untimed appearance",
    smallEventPages.some((page) => page.nextCursor && page.nextCursor[1] === null),
    true,
  );

  checkPlans(admin.id, magistrate.id);
}

/**
 * EXPLAIN evidence at volume: 20,000 more rows per table in a rolled-back
 * transaction, analysed, then each list's first page and a page from the
 * middle (cursor = the 10,000th row) as the signed-in user. The queries are
 * the SQL PostgREST runs for the hooks: list filter, cursor range bound,
 * the "after" or-tree, ORDER BY the key, LIMIT the page size.
 */
function checkPlans(adminId, magistrateId) {
  const bulk = `begin;
set local request.jwt.claims = '${claims(adminId)}';
insert into public.case_law (case_name, citation, court, jurisdiction, review_status, updated_at)
select '${tag} bulk ' || g, '[2024] ${tag}b ' || g, 'Fixture Court', 'Fixture',
  case when g % 10 = 0 then 'draft' else 'published' end, now() - g * interval '1 minute'
from generate_series(1, 20000) g;
insert into public.statutes (code, title, jurisdiction)
select '${tag}-bulk-' || g, 'Bulk Act ' || g, 'Fixture' from generate_series(1, 20000) g;
insert into public.import_jobs (content_type, created_by, created_at)
select 'case_law', '${adminId}', now() - g * interval '1 minute' from generate_series(1, 20000) g;
set local request.jwt.claims = '${claims(magistrateId)}';
insert into public.judgments (title, updated_at)
select '${tag} bulk judgment ' || g, now() - g * interval '1 minute' from generate_series(1, 20000) g;
insert into public.bench_notes (title, entity_type, entity_id, updated_at)
select '${tag} bulk note ' || g, 'judgment',
  (select id from public.judgments where title = '${tag} judgment 1'), now() - g * interval '1 minute'
from generate_series(1, 20000) g;
insert into public.docket_events (docket_matter_id, scheduled_date, scheduled_time)
select m.id, date '${FROM}' + (g % 100), time '09:00' + (g % 16) * interval '30 minutes'
from public.docket_matters m, generate_series(1, 20000) g
where m.matter_title = 'BE15 matter ${tag} BE15-1';
analyze public.case_law, public.statutes, public.import_jobs, public.judgments,
  public.bench_notes, public.docket_events, public.docket_matters;
`;
  // Cursor values are read as the user, then the plans are taken as the user.
  const explain = (userId, label, cursorQuery, pageQuery) => `
set local role authenticated;
set local request.jwt.claims = '${claims(userId)}';
${cursorQuery} \\gset
\\echo @@${label}_first
explain (costs off) ${pageQuery(false)};
\\echo @@${label}_next
explain (costs off) ${pageQuery(true)};
reset role;
`;
  const script =
    bulk +
    explain(
      adminId,
      "case_law",
      "select updated_at::text as c1, id::text as c2 from public.case_law where review_status = 'published' order by updated_at desc, id desc offset 10000 limit 1",
      (after) => `select id, case_name, updated_at from public.case_law
        where review_status = 'published'
        ${after ? "and updated_at <= :'c1' and (updated_at < :'c1' or (updated_at = :'c1' and id < :'c2'))" : ""}
        order by updated_at desc, id desc limit 300`,
    ) +
    explain(
      adminId,
      "statutes",
      "select title as c1, id::text as c2 from public.statutes where review_status = 'published' and is_current_version = true order by title, id offset 10000 limit 1",
      (after) => `select id, title from public.statutes
        where review_status = 'published' and is_current_version = true
        ${after ? "and title >= :'c1' and (title > :'c1' or (title = :'c1' and id > :'c2'))" : ""}
        order by title, id limit 500`,
    ) +
    explain(
      adminId,
      "import_jobs",
      "select created_at::text as c1, id::text as c2 from public.import_jobs order by created_at desc, id desc offset 10000 limit 1",
      (after) => `select * from public.import_jobs
        ${after ? "where created_at <= :'c1' and (created_at < :'c1' or (created_at = :'c1' and id < :'c2'))" : ""}
        order by created_at desc, id desc limit 200`,
    ) +
    explain(
      magistrateId,
      "judgments",
      "select updated_at::text as c1, id::text as c2 from public.judgments order by updated_at desc, id desc offset 10000 limit 1",
      (after) => `select id, title, updated_at from public.judgments
        ${after ? "where updated_at <= :'c1' and (updated_at < :'c1' or (updated_at = :'c1' and id < :'c2'))" : ""}
        order by updated_at desc, id desc limit 200`,
    ) +
    explain(
      magistrateId,
      "bench_notes",
      "select updated_at::text as c1, id::text as c2 from public.bench_notes order by updated_at desc, id desc offset 10000 limit 1",
      (after) => `select id, title, updated_at from public.bench_notes
        ${after ? "where updated_at <= :'c1' and (updated_at < :'c1' or (updated_at = :'c1' and id < :'c2'))" : ""}
        order by updated_at desc, id desc limit 300`,
    ) +
    explain(
      magistrateId,
      "events",
      `select scheduled_date::text as c1, scheduled_time::text as c2, id::text as c3 from public.docket_events
        where scheduled_date between '${FROM}' and '${TO}'
        order by scheduled_date, scheduled_time nulls first, id offset 10000 limit 1`,
      (
        after,
      ) => `select e.id, e.scheduled_date, e.scheduled_time, m.case_number from public.docket_events e
        join public.docket_matters m on m.id = e.docket_matter_id and m.deleted_at is null
        where e.scheduled_date >= '${FROM}' and e.scheduled_date <= '${TO}'
        ${after ? "and e.scheduled_date >= :'c1' and (e.scheduled_date > :'c1' or (e.scheduled_date = :'c1' and (e.scheduled_time > :'c2' or (e.scheduled_time = :'c2' and e.id > :'c3'))))" : ""}
        order by e.scheduled_date, e.scheduled_time nulls first, e.id limit 400`,
    ) +
    "rollback;\n";
  const plans = sections(runSql(script, "test-list-keyset-paging"));
  const expectIndex = {
    case_law: "case_law_published_updated_at_idx",
    statutes: "statutes_published_current_title_idx",
    import_jobs: "import_jobs_created_at_idx",
    judgments: "judgments_updated_at_idx",
    bench_notes: "bench_notes_author_updated_at_idx",
    events: "docket_events_scheduled_idx",
  };
  for (const [label, index] of Object.entries(expectIndex)) {
    for (const page of ["first", "next"]) {
      const plan = plans[`${label}_${page}`] ?? "";
      console.log(`\n-- ${label} ${page} page plan --\n${plan}`);
      check(`EXPLAIN ${label} ${page} page uses ${index}`, plan.includes(index), true);
      check(`EXPLAIN ${label} ${page} page does not sort the table`, /\bSort\b/.test(plan), false);
    }
  }
}

/** Each statement on its own, so one that fails still lets the rest run. */
function cleanup() {
  const [admin, magistrate] = created.users;
  if (!admin || !magistrate) return;
  const courtIds = `select id from public.courts where name = 'BE15 Court ${tag}'`;
  const statements = [
    `delete from public.bench_notes where author_id = '${magistrate}'`,
    `delete from public.docket_events where docket_matter_id in (select id from public.docket_matters where court_id in (${courtIds}))`,
    `delete from public.docket_matters where court_id in (${courtIds})`,
    `delete from public.judgments where owner_id = '${magistrate}'`,
    `delete from public.case_law where case_name like '${tag} v Crown %'`,
    `delete from public.statutes where code like '${tag}-%'`,
    `delete from public.import_jobs where created_by = '${admin}'`,
    `delete from public.magistrate_courts where profile_id = '${magistrate}'`,
    `delete from public.courts where name = 'BE15 Court ${tag}'`,
    `delete from public.magisterial_districts where name = 'BE15 District ${tag}'`,
  ];
  for (const statement of statements) {
    try {
      runSql(`${statement};\n`, "test-list-keyset-paging");
    } catch (error) {
      console.error(`Cleanup failed (remove by hand): ${statement}\n`, error.message);
    }
  }
}

try {
  await main();
} catch (error) {
  console.error(error);
  failures += 1;
} finally {
  cleanup();
  for (const id of created.users) {
    const { error } = await service.auth.admin.deleteUser(id);
    if (error) console.error(`Could not delete fixture user ${id}:`, error.message);
  }
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll checks passed");
