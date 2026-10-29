// @live-db  opens a real Supabase connection: `npm test` skips it, `npm run test:live` includes it
/**
 * One failing maintenance step no longer skips the rest, and an admin is
 * told (0173), on a real database.
 *
 *   BE-16  inside one transaction that is rolled back, every step of
 *          run_scheduled_maintenance() is replaced by a stub that records
 *          that it ran, and two of them raise. Then:
 *          - the run itself completes;
 *          - every other step still ran (and the failing steps' own writes
 *            were rolled back);
 *          - each failure left an audit_log row (table_name
 *            scheduled_maintenance) naming the step and the error;
 *          - a fixture admin holds one maintenance_failed notification per
 *            failed step;
 *          - no client role can execute run_scheduled_maintenance or
 *            record_maintenance_failure.
 *
 * Needs `psql` and the local stack (`npm run db:start`); nothing persists.
 *
 *   npm run test:scheduled-maintenance
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

const STEPS = [
  "mark_past_hearings",
  "flag_stale_drafts",
  "notify_tomorrows_hearings",
  "apply_data_retention",
  "dispatch_pending_webhooks",
];
const FAILING = ["flag_stale_drafts", "dispatch_pending_webhooks"];
const admin = randomUUID();

const script = `begin;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token)
values ('00000000-0000-0000-0000-000000000000', '${admin}', 'authenticated', 'authenticated',
  'be16-admin-${admin.slice(0, 8)}@example.test', '', now(),
  '{"provider":"email","providers":["email"]}', '{"full_name":"BE16 Admin"}', now(), now(), '', '', '', '');
update public.profiles set role = 'admin', is_active = true where id = '${admin}';

create temp table be16_ran (step text) on commit drop;
create temp table be16_outcome (ok boolean, error text) on commit drop;

-- Each step becomes a stub that records it ran; the failing ones raise
-- after recording, so their own write must be rolled back with them.
do $do$
declare
  s text;
  v_result text;
begin
  foreach s in array array[${STEPS.map((s) => `'${s}'`).join(", ")}] loop
    v_result := pg_get_function_result(('public.' || s || '()')::regprocedure);
    execute format(
      $f$create or replace function public.%I() returns %s language plpgsql as $b$
         begin
           insert into pg_temp.be16_ran values (%L);
           %s
           return%s;
         end $b$$f$,
      s, v_result, s,
      case when s = any (array[${FAILING.map((s) => `'${s}'`).join(", ")}])
        then format('raise exception %L;', 'BE16 forced failure in ' || s) else '' end,
      case when v_result = 'void' then '' else ' null' end
    );
  end loop;
end $do$;

do $do$
begin
  perform public.run_scheduled_maintenance();
  insert into pg_temp.be16_outcome values (true, null);
exception when others then
  insert into pg_temp.be16_outcome values (false, sqlerrm);
end $do$;

\\echo @@outcome
select coalesce(ok::text, '') || '|' || coalesce(error, '') from pg_temp.be16_outcome;
\\echo @@ran
select coalesce(string_agg(step, ',' order by step), '') from pg_temp.be16_ran;
\\echo @@audit
select coalesce(string_agg((new_data ->> 'step') || ':' || (new_data ->> 'error'), '|' order by new_data ->> 'step'), '')
from public.audit_log
where table_name = 'scheduled_maintenance' and created_at = now();
\\echo @@notifications
select coalesce(string_agg(type || ':' || link || ':' || (body like '%BE16 forced failure%')::text, '|' order by link), '')
from public.notifications
where user_id = '${admin}';
\\echo @@grants
select string_agg(r || ':' || f || ':' || has_function_privilege(r, f, 'execute')::text, '|' order by r, f)
from unnest(array['anon', 'authenticated']) r,
     unnest(array['public.run_scheduled_maintenance()', 'public.record_maintenance_failure(text, text, text)']) f;
rollback;
`;

try {
  const out = sections(runSql(script, "test-scheduled-maintenance"));

  check("BE-16 the run completes although two steps raise", out.outcome, "true|");
  check(
    "BE-16 every step that did not fail still ran, and the failed steps' writes were rolled back",
    out.ran,
    STEPS.filter((s) => !FAILING.includes(s))
      .sort()
      .join(","),
  );
  check(
    "BE-16 each failure has an audit_log row naming the step and the error",
    out.audit,
    [...FAILING]
      .sort()
      .map((s) => `${s}:BE16 forced failure in ${s}`)
      .join("|"),
  );
  check(
    "BE-16 the admin holds one maintenance_failed notice per failed step",
    out.notifications,
    [...FAILING]
      .sort()
      .map((s) => `maintenance_failed:/admin/operations?maintenance=${s}:true`)
      .join("|"),
  );
  check(
    "BE-16 no client role can run maintenance or record a failure",
    out.grants,
    [
      "anon:public.record_maintenance_failure(text, text, text):false",
      "anon:public.run_scheduled_maintenance():false",
      "authenticated:public.record_maintenance_failure(text, text, text):false",
      "authenticated:public.run_scheduled_maintenance():false",
    ].join("|"),
  );
} catch (error) {
  console.error(error);
  failures += 1;
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll checks passed");
