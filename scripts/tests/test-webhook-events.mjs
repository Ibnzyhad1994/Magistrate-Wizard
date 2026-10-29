// @live-db  opens a real Supabase connection: `npm test` skips it, `npm run test:live` includes it
/**
 * One webhook event per domain action, with its court and the people it
 * notified, scoped to the endpoint's court (0232), on a real database,
 * inside one transaction that is rolled back.
 *
 * Four endpoints subscribe to every event: one for every court, one for
 * court C, one for court D, and an inactive one. Then, acting as the
 * magistrates (auth.uid() set as the app's requests set it):
 *
 *   share.granted / share.revoked  sharing a court C docket matter with one
 *          person, then revoking it, queues one event each for the
 *          every-court and court C endpoints, none for court D or the
 *          inactive one, with court C and the recipient.
 *   judgment.final  finalising a judgment shared with two magistrates
 *          notifies both and queues one event, for the every-court endpoint
 *          only (judgments are never court-owned), listing both.
 *   hearing.tomorrow  a court C hearing tomorrow notifies both of the
 *          court's magistrates and queues one event per endpoint with them
 *          as recipients; running the job again queues nothing more.
 *   clerk_request.created  a clerk's request for court C queues one event
 *          per endpoint, addressed to the court's staff and every active
 *          administrator.
 *   No payload carries a title, case number or notice body, and inserting
 *   a notice by itself queues nothing (the old per-notice trigger is gone).
 *
 * Needs `psql` and the local stack (`npm run db:start`); nothing persists.
 *
 *   npm run test:webhook-events
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
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

const tag = randomUUID().slice(0, 8);
const MARK = `WH-${tag}`;
const id = () => randomUUID();
const people = { A: id(), M1: id(), M2: id(), R: id(), K: id() };
const { A, M1, M2, R, K } = people;
const district = id();
const C = id();
const D = id();
const endpoints = { all: id(), courtC: id(), courtD: id(), inactive: id() };
const matter = id();
const judgment = id();
const hearing = id();
const sorted = (...ids) => [...ids].sort();

const EVENTS =
  "'{share.granted,share.revoked,judgment.final,hearing.tomorrow,clerk_request.created}'";
// The acting user, as the triggers see them (auth.uid()).
const as = (sub) =>
  `set local request.jwt.claims = '${JSON.stringify({ sub, role: "authenticated" })}';`;

const users = Object.entries(people)
  .map(
    ([name, uid]) => `('00000000-0000-0000-0000-000000000000', '${uid}', 'authenticated',
  'authenticated', 'wh-${name.toLowerCase()}-${tag}@example.test', '', now(),
  '{"provider":"email","providers":["email"]}', '{"full_name":"WH ${name}"}', now(), now(),
  '', '', '', '')`,
  )
  .join(",\n");

// Every outbox row queued so far for this run's endpoints, per endpoint.
const queued = (label, where) => `\\echo @@${label}
select coalesce(json_agg(json_build_object(
  'endpoint', case o.endpoint_id
    when '${endpoints.all}' then 'all' when '${endpoints.courtC}' then 'courtC'
    when '${endpoints.courtD}' then 'courtD' when '${endpoints.inactive}' then 'inactive' end,
  'payload', o.payload) order by o.endpoint_id), '[]')
from public.webhook_outbox o
where o.endpoint_id in ('${endpoints.all}', '${endpoints.courtC}', '${endpoints.courtD}', '${endpoints.inactive}')
  and ${where};`;
const notices = (label, type, link) => `\\echo @@${label}
select count(*) from public.notifications
where type = '${type}' and link = '${link}'
  and user_id in ('${A}', '${M1}', '${M2}', '${R}', '${K}');`;

const script = `begin;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token)
values ${users};
update public.profiles set role = 'admin' where id = '${A}';
insert into public.magisterial_districts (id, name) values ('${district}', '${MARK} District');
insert into public.courts (id, name, jurisdiction, district_id, is_active)
values ('${C}', '${MARK} Court C', 'Test', '${district}', true),
       ('${D}', '${MARK} Court D', 'Test', '${district}', true);
insert into public.magistrate_courts (profile_id, court_id, assignment_type)
values ('${M1}', '${C}', 'regular'), ('${M2}', '${C}', 'acting'), ('${R}', '${D}', 'regular');
insert into public.webhook_endpoints (id, url, secret, events, active, court_id)
values ('${endpoints.all}', 'https://all.example.test/hook', 's', ${EVENTS}, true, null),
       ('${endpoints.courtC}', 'https://c.example.test/hook', 's', ${EVENTS}, true, '${C}'),
       ('${endpoints.courtD}', 'https://d.example.test/hook', 's', ${EVENTS}, true, '${D}'),
       ('${endpoints.inactive}', 'https://off.example.test/hook', 's', ${EVENTS}, false, null);

-- ---------- a docket share, granted then revoked ----------
${as(M1)}
insert into public.docket_matters (id, court_id, district_id, case_number, matter_title)
values ('${matter}', '${C}', '${district}', '${MARK}-CASE', '${MARK} secret matter title');
insert into public.shares (item_type, item_id, recipient_id, permission)
values ('docket_matter', '${matter}', '${R}', 'view');
${queued("share_granted", "o.event = 'share.granted'")}
${as(M1)}
update public.shares set revoked_at = now()
where item_type = 'docket_matter' and item_id = '${matter}' and recipient_id = '${R}';
${queued("share_revoked", "o.event = 'share.revoked'")}

-- ---------- a judgment shared with two magistrates, then finalised ----------
${as(M1)}
insert into public.judgments (id, title, content_text)
values ('${judgment}', '${MARK} secret judgment title', '${MARK} body');
insert into public.shares (item_type, item_id, recipient_id, permission)
values ('judgment', '${judgment}', '${M2}', 'view'), ('judgment', '${judgment}', '${R}', 'view');
update public.judgments set status = 'final' where id = '${judgment}';
${notices("judgment_notices", "judgment_final", `/judgments/${judgment}`)}
${queued("judgment_final", "o.event = 'judgment.final'")}

-- ---------- a hearing tomorrow, and the job run twice ----------
${as(M1)}
insert into public.docket_events (id, docket_matter_id, scheduled_date, event_status, presiding_magistrate_id)
values ('${hearing}', '${matter}', public.guyana_today() + 1, 'scheduled', '${M1}');
do $$ begin perform public.notify_tomorrows_hearings(); end $$;
${notices("hearing_notices", "hearing_tomorrow", `/docket/${matter}`)}
${queued("hearing_once", `o.event = 'hearing.tomorrow' and o.payload #>> '{data,docket_event_id}' = '${hearing}'`)}
do $$ begin perform public.notify_tomorrows_hearings(); end $$;
${queued("hearing_twice", `o.event = 'hearing.tomorrow' and o.payload #>> '{data,docket_event_id}' = '${hearing}'`)}

-- ---------- a clerk asks for court C ----------
insert into public.clerk_access_requests (profile_id, court_id) values ('${K}', '${C}');
${queued("clerk_request", "o.event = 'clerk_request.created'")}
\\echo @@clerk_expected
select json_agg(x order by x) from (
  select '${M1}'::uuid as x union select '${M2}'::uuid
  union select p.id from public.profiles p where p.role = 'admin' and p.is_active
) s;

-- ---------- nothing carries content; a bare notice queues nothing ----------
\\echo @@content_leaks
select count(*) from public.webhook_outbox o
where o.endpoint_id in ('${endpoints.all}', '${endpoints.courtC}', '${endpoints.courtD}', '${endpoints.inactive}')
  and (o.payload::text like '%secret%' or o.payload::text like '%${MARK}-CASE%'
       or o.payload ? 'title' or o.payload ? 'body');
\\echo @@before_bare_notice
select count(*) from public.webhook_outbox;
do $$ begin perform public.notify_user('${R}', 'share_granted', 'A bare notice', 'no action', '/nowhere/${tag}'); end $$;
\\echo @@after_bare_notice
select count(*) from public.webhook_outbox;
rollback;`;

const out = sections(runSql(script, "test:webhook-events"));
const rows = (label) => JSON.parse(out[label]);
const byEndpoint = (list) => list.map((row) => row.endpoint).sort();
const sameEvent = (list) => new Set(list.map((row) => row.payload.id)).size === 1;

{
  const granted = rows("share_granted");
  console.log("share.granted payload:", JSON.stringify(granted[0]?.payload));
  check(
    "share.granted: one event each for the every-court and court C endpoints only",
    byEndpoint(granted),
    ["all", "courtC"],
  );
  check("share.granted: both copies are the same event", sameEvent(granted), true);
  check("share.granted: carries court C", granted[0]?.payload.court_id, C);
  check("share.granted: carries the recipient", granted[0]?.payload.recipient_ids, [R]);
  check(
    "share.granted: carries the share's ids, not its content",
    Object.keys(granted[0]?.payload.data ?? {}).sort(),
    ["granted_by", "item_id", "item_type", "link", "permission", "share_id"],
  );
  check(
    "share.granted: the granter is the acting magistrate",
    granted[0]?.payload.data.granted_by,
    M1,
  );

  const revoked = rows("share_revoked");
  check(
    "share.revoked: one event each for the every-court and court C endpoints only",
    byEndpoint(revoked),
    ["all", "courtC"],
  );
  check(
    "share.revoked: carries court C and the recipient",
    [revoked[0]?.payload.court_id, revoked[0]?.payload.recipient_ids],
    [C, [R]],
  );
}

{
  check("judgment.final: both share recipients are notified", Number(out.judgment_notices), 2);
  const final = rows("judgment_final");
  console.log("judgment.final payload:", JSON.stringify(final[0]?.payload));
  check(
    "judgment.final: one event, for the every-court endpoint only (no court)",
    byEndpoint(final),
    ["all"],
  );
  check("judgment.final: no court", final[0]?.payload.court_id, null);
  check("judgment.final: lists both recipients", final[0]?.payload.recipient_ids, sorted(M2, R));
  check("judgment.final: names the judgment", final[0]?.payload.data.judgment_id, judgment);
}

{
  check("hearing.tomorrow: both court C magistrates are notified", Number(out.hearing_notices), 2);
  const once = rows("hearing_once");
  console.log("hearing.tomorrow payload:", JSON.stringify(once[0]?.payload));
  check(
    "hearing.tomorrow: one event each for the every-court and court C endpoints only",
    byEndpoint(once),
    ["all", "courtC"],
  );
  check("hearing.tomorrow: carries court C", once[0]?.payload.court_id, C);
  check(
    "hearing.tomorrow: addressed to the court's staff",
    once[0]?.payload.recipient_ids,
    sorted(M1, M2),
  );
  check(
    "hearing.tomorrow: a second run queues nothing more",
    rows("hearing_twice").length,
    once.length,
  );
}

{
  const request = rows("clerk_request");
  check(
    "clerk_request.created: one event each for the every-court and court C endpoints only",
    byEndpoint(request),
    ["all", "courtC"],
  );
  check("clerk_request.created: carries court C", request[0]?.payload.court_id, C);
  check(
    "clerk_request.created: addressed to the court's staff and every active administrator",
    request[0]?.payload.recipient_ids,
    JSON.parse(out.clerk_expected),
  );
  check("clerk_request.created: names the clerk", request[0]?.payload.data.profile_id, K);
}

check("no payload carries a title, case number or notice body", Number(out.content_leaks), 0);

// Also written to LIVE_REPORT_DIR when set: live-db.yml prints those files
// (the runner prints a script's output only when it fails).
if (process.env.LIVE_REPORT_DIR) {
  const row = (action, notified, label) => {
    const list = rows(label);
    const endpointsHit = byEndpoint(list).join(", ") || "none";
    return `| ${action} | ${notified} | ${list.length} (${endpointsHit}) | ${list[0]?.payload.court_id ? "yes" : "no"} | ${list[0]?.payload.recipient_ids.length ?? 0} |`;
  };
  mkdirSync(process.env.LIVE_REPORT_DIR, { recursive: true });
  writeFileSync(
    path.join(process.env.LIVE_REPORT_DIR, "webhook-events.md"),
    [
      "### Webhook events (0232): one per action per endpoint (every-court, court C, court D, inactive)",
      "",
      "| Action | Notices | Events queued (endpoints) | Court | Recipients |",
      "| --- | --- | --- | --- | --- |",
      row("share a court C docket matter", 1, "share_granted"),
      row("revoke that share", 1, "share_revoked"),
      row("finalise a judgment shared with two", Number(out.judgment_notices), "judgment_final"),
      row(
        "hearing tomorrow at court C (job run twice)",
        Number(out.hearing_notices),
        "hearing_twice",
      ),
      row("clerk asks for court C", "staff and admins", "clerk_request"),
      "",
      `Payloads carrying a title, case number or body: ${out.content_leaks}.`,
      "",
    ].join("\n"),
  );
}
check(
  "a notice by itself queues no webhook",
  Number(out.after_bare_notice),
  Number(out.before_bare_notice),
);

if (failures > 0) {
  console.log(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll webhook event checks passed.");
