// @live-db  opens a real Supabase connection: `npm test` skips it, `npm run test:live` includes it
/**
 * Global search limits each result type on its own (0172), on a real
 * database, as a signed-in magistrate.
 *
 *   BE-14  inside one transaction that is rolled back, seeds 30 Case Law
 *          rows that rank high for a nonsense word and one Docket Matter
 *          whose charge mentions it (a low rank). Then global_search(word, 20):
 *          - still returns the Docket Matter (one LIMIT across all types
 *            used to drop it behind the Case Law hits);
 *          - returns at most 20 rows of any one type (20 Case Law);
 *          - keeps the response ordered by rank, highest first;
 *          - p_limit 1 gives one row per type.
 *
 * Needs `psql` and the local stack (`npm run db:start`); nothing persists.
 *
 *   npm run test:global-search-per-type
 */
import { randomUUID } from "node:crypto";
import { runSql, sections } from "../test-support/psql.mjs";

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

// Deliberately not a word: it must not collide with seeded library text.
const WORD = "zzqxbe14word";
const magistrate = randomUUID();
const curator = randomUUID();
const district = randomUUID();
const court = randomUUID();
const claims = JSON.stringify({ sub: magistrate, role: "authenticated" });

const script = `begin;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token)
values ('00000000-0000-0000-0000-000000000000', '${magistrate}', 'authenticated', 'authenticated',
  'be14-magistrate-${magistrate.slice(0, 8)}@example.test', '', now(),
  '{"provider":"email","providers":["email"]}', '{"full_name":"BE14 Magistrate"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '${curator}', 'authenticated', 'authenticated',
  'be14-curator-${curator.slice(0, 8)}@example.test', '', now(),
  '{"provider":"email","providers":["email"]}', '{"full_name":"BE14 Curator"}', now(), now(), '', '', '', '');
-- Only an admin may add canonical Case Law (case_law_ownership_guard).
update public.profiles set role = 'admin' where id = '${curator}';
insert into public.magisterial_districts (id, name) values ('${district}', 'BE14 District ${district.slice(0, 8)}');
insert into public.courts (id, name, jurisdiction, district_id, is_active)
values ('${court}', 'BE14 Court ${court.slice(0, 8)}', 'Test', '${district}', true);
insert into public.magistrate_courts (profile_id, court_id) values ('${magistrate}', '${court}');

-- Thirty case-name hits, added by the curator: each ranks at least 0.5 (the
-- substring floor).
set local request.jwt.claims = '${JSON.stringify({ sub: curator, role: "authenticated" })}';
insert into public.case_law (case_name, citation, court, jurisdiction, summary, review_status)
select '${WORD} v Crown ' || g, '[2024] BE14 ' || g, 'Fixture Court', 'Fixture',
  'About ${WORD}.', 'published'
from generate_series(1, 30) g;

-- One matter that mentions the word only in its charge: a low full-text rank.
set local request.jwt.claims = '${claims}';
insert into public.docket_matters (case_number, matter_title, charge_or_issue, court_id, district_id)
values ('BE14-1/2026', 'Police v Fixture', 'Possession of ${WORD}', '${court}', '${district}');

set local role authenticated;
\\echo @@types
select coalesce(string_agg(entity_type || '=' || n, ',' order by entity_type), '')
from (select entity_type, count(*) n from public.global_search('${WORD}', 20) group by entity_type) t;
\\echo @@ordered
select bool_and(rank <= prev) from (
  select rank, lag(rank, 1, 'Infinity'::real) over (order by ord) prev
  from (select r.rank, row_number() over () ord from public.global_search('${WORD}', 20) r) numbered
) pairs;
\\echo @@one_each
select coalesce(string_agg(entity_type || '=' || n, ',' order by entity_type), '')
from (select entity_type, count(*) n from public.global_search('${WORD}', 1) group by entity_type) t;
rollback;
`;

try {
  const out = sections(runSql(script, "test-global-search-per-type"));
  check(
    "BE-14 the docket matter survives thirty higher-ranked case law hits, case law capped at 20",
    out.types,
    "case_law=20,docket_matter=1",
  );
  check("BE-14 the response stays ordered by rank, highest first", out.ordered, "t");
  check("BE-14 p_limit 1 gives one row per type", out.one_each, "case_law=1,docket_matter=1");
} catch (error) {
  console.error(error);
  failures += 1;
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll checks passed");
