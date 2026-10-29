// @live-db  opens a real Supabase connection: `npm test` skips it, `npm run test:live` includes it
/**
 * Court hand-over (0220), on a real database, inside one transaction that is
 * rolled back.
 *
 *   BE-26  pre-flight: a magistrate sits a court with seven matters. Two are
 *          part-heard before them and not retained (evidence taken at a
 *          held sitting; a part-way trial whose latest held sitting they
 *          presided). One retained, one completed, one only scheduled, one
 *          last heard by a colleague and one with a cancelled sitting are
 *          not. Four of their judgments are pinned there: private,
 *          discoverable, shared, and on the retained matter.
 *          - relinquish_preflight lists exactly the two matters and the
 *            four pins, one of them to unlink; the magistrate sees case
 *            numbers and judgment titles, an administrator ids only, and
 *            another magistrate is refused.
 *          - relinquishing unlinks the private pin only, audited; ending the
 *            retained assignment unlinks the pin on that matter; a pin left
 *            behind (its share revoked later) is counted, then cleared, by
 *            unlink_my_orphaned_judgment_pins; the discoverable pin stays.
 *   BE-26  transfer: an administrator moves a final judgment of the
 *          departed magistrate to a magistrate who sits the court.
 *          - a magistrate, another court's magistrate, a court the owner
 *            never sat, an inactive magistrate, a blank reason and the
 *            current owner are refused;
 *          - the transfer changes the owner only (status, finalisation,
 *            content and versions unchanged), records the original author,
 *            is audited, notifies both magistrates and returns ids only;
 *          - owner_id cannot change directly, not even for the service role;
 *          - a second transfer keeps the original author;
 *          - the original author and an administrator see the transfer
 *            rows, another magistrate does not.
 *
 * Needs `psql` and the local stack (`npm run db:start`); nothing persists.
 *
 *   npm run test:court-handover
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

const tag = randomUUID().slice(0, 8);
const id = () => randomUUID();
const people = { A: id(), M: id(), T: id(), O: id(), X: id(), I: id() };
const { A, M, T, O, X, I } = people;
const district = id();
const C = id();
const D = id();
const MA = id();
const m = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((n) => [n, id()]));
const J1 = id();
const J2 = id();
const J3 = id();
const J4 = id();
const JT = id();
const P1 = id();
const P2 = id();
const P3 = id();
const P4 = id();
const as = (sub) =>
  `set local request.jwt.claims = '${JSON.stringify({ sub, role: "authenticated" })}';`;
const pinsLeft = `select coalesce(json_agg(id order by id), '[]') from public.docket_matter_judgments
  where id in ('${P1}', '${P2}', '${P3}', '${P4}');`;
const transfer = (to, court, reason = "BE26 hand-over") =>
  `select public.transfer_judgment_ownership('${JT}', '${to}', '${court}', '${reason}')`;

const users = Object.entries(people)
  .map(
    ([name, uid]) => `('00000000-0000-0000-0000-000000000000', '${uid}', 'authenticated',
  'authenticated', 'be26-${name.toLowerCase()}-${tag}@example.test', '', now(),
  '{"provider":"email","providers":["email"]}', '{"full_name":"BE26 ${name}"}', now(), now(),
  '', '', '', '')`,
  )
  .join(",\n");

const script = `begin;
create function pg_temp.outcome(p_sql text) returns text language plpgsql as $f$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end;
$f$;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token)
values ${users};
update public.profiles set role = 'admin' where id = '${A}';
insert into public.magisterial_districts (id, name) values ('${district}', 'BE26 District ${tag}');
insert into public.courts (id, name, jurisdiction, district_id, is_active)
values ('${C}', 'BE26 Court ${tag}', 'Test', '${district}', true),
       ('${D}', 'BE26 Other Court ${tag}', 'Test', '${district}', true);
insert into public.magistrate_courts (id, profile_id, court_id, assignment_type)
values ('${MA}', '${M}', '${C}', 'regular');
insert into public.magistrate_courts (profile_id, court_id, assignment_type)
values ('${T}', '${C}', 'acting'), ('${O}', '${C}', 'acting'), ('${I}', '${C}', 'acting'),
       ('${X}', '${D}', 'acting');
update public.profiles set is_active = false where id = '${I}';

${as(M)}
insert into public.docket_matters (id, court_id, district_id, case_number, matter_title, trial_status)
values
  ('${m[1]}', '${C}', '${district}', 'BE26-1-${tag}', 'BE26 evidence taken', 'not_commenced'),
  ('${m[2]}', '${C}', '${district}', 'BE26-2-${tag}', 'BE26 retained', 'not_commenced'),
  ('${m[3]}', '${C}', '${district}', 'BE26-3-${tag}', 'BE26 completed', 'not_commenced'),
  ('${m[4]}', '${C}', '${district}', 'BE26-4-${tag}', 'BE26 trial part way', 'partial'),
  ('${m[5]}', '${C}', '${district}', 'BE26-5-${tag}', 'BE26 only scheduled', 'not_commenced'),
  ('${m[6]}', '${C}', '${district}', 'BE26-6-${tag}', 'BE26 colleague heard last', 'partial'),
  ('${m[7]}', '${C}', '${district}', 'BE26-7-${tag}', 'BE26 cancelled sitting', 'not_commenced');
insert into public.docket_events (docket_matter_id, scheduled_date, event_status,
  presiding_magistrate_id, witnesses_completed, outcome_at_event)
values
  ('${m[1]}', current_date - 7, 'completed', '${M}', 2, null),
  ('${m[2]}', current_date - 7, 'completed', '${M}', 2, null),
  ('${m[3]}', current_date - 7, 'completed', '${M}', 2, null),
  ('${m[4]}', current_date - 3, 'past', '${M}', null, 'Adjourned'),
  ('${m[5]}', current_date + 5, 'scheduled', '${M}', 1, null),
  ('${m[6]}', current_date - 10, 'completed', '${M}', null, 'Adjourned'),
  ('${m[6]}', current_date - 2, 'completed', '${O}', null, 'Adjourned'),
  ('${m[7]}', current_date - 4, 'cancelled', '${M}', null, 'Part-heard');
insert into public.docket_matter_assignments (docket_matter_id) values ('${m[2]}');
update public.docket_matters set status = 'completed' where id = '${m[3]}';
insert into public.judgments (id, title, content_text, is_discoverable)
values ('${J1}', 'BE26 Private', 'BE26 private body', false),
       ('${J2}', 'BE26 Discoverable', 'BE26 discoverable body', true),
       ('${J3}', 'BE26 Shared', 'BE26 shared body', false),
       ('${J4}', 'BE26 Retained', 'BE26 retained body', false),
       ('${JT}', 'BE26 Transfer', 'BE26 transfer body', false);
insert into public.shares (item_type, item_id, recipient_id, permission) values ('judgment', '${J3}', '${O}', 'view');
insert into public.docket_matter_judgments (id, docket_matter_id, judgment_id)
values ('${P1}', '${m[1]}', '${J1}'), ('${P2}', '${m[1]}', '${J2}'),
       ('${P3}', '${m[3]}', '${J3}'), ('${P4}', '${m[2]}', '${J4}');
update public.judgments set status = 'final' where id = '${JT}';

-- ---------- pre-flight ----------
set local role authenticated;
\\echo @@pre_self
select public.relinquish_preflight('${MA}');
reset role;
${as(A)}
set local role authenticated;
\\echo @@pre_admin
select public.relinquish_preflight('${MA}');
reset role;
${as(O)}
set local role authenticated;
\\echo @@pre_other
select pg_temp.outcome($q$select public.relinquish_preflight('${MA}')$q$);
reset role;

-- ---------- relinquish and the pins it leaves ----------
${as(M)}
set local role authenticated;
\\echo @@relinquished
select (public.relinquish_magistrate_court('${MA}')).ended_at is not null;
reset role;
\\echo @@pins_after_relinquish
${pinsLeft}
\\echo @@unlink_audit
select coalesce(json_agg(json_build_object(
  'record_id', a.record_id, 'action', a.action, 'actor', a.actor_id,
  'event', a.new_data ->> 'event', 'reason', a.new_data ->> 'reason',
  'judgment_id', a.old_data ->> 'judgment_id') order by a.id), '[]')
from public.audit_log a
where a.table_name = 'docket_matter_judgments' and a.record_id = '${P1}';

update public.docket_matter_assignments set ended_at = now()
where docket_matter_id = '${m[2]}' and profile_id = '${M}';
\\echo @@pins_after_retained_end
${pinsLeft}

update public.shares set revoked_at = now() where item_type = 'judgment' and item_id = '${J3}';
set local role authenticated;
\\echo @@dry_run
select public.unlink_my_orphaned_judgment_pins(true);
reset role;
\\echo @@pins_after_dry_run
${pinsLeft}
set local role authenticated;
\\echo @@unlinked
select public.unlink_my_orphaned_judgment_pins();
reset role;
\\echo @@pins_final
${pinsLeft}

-- ---------- transfer ----------
${as(O)}
set local role authenticated;
\\echo @@t_not_admin
select pg_temp.outcome($q$${transfer(T, C)}$q$);
reset role;
${as(A)}
set local role authenticated;
\\echo @@t_target_elsewhere
select pg_temp.outcome($q$${transfer(X, C)}$q$);
\\echo @@t_owner_never_sat
select pg_temp.outcome($q$${transfer(X, D)}$q$);
\\echo @@t_inactive
select pg_temp.outcome($q$${transfer(I, C)}$q$);
\\echo @@t_no_reason
select pg_temp.outcome($q$${transfer(T, C, "   ")}$q$);
\\echo @@t_same_owner
select pg_temp.outcome($q$${transfer(M, C)}$q$);
\\echo @@t_ok
${transfer(T, C)};
reset role;
\\echo @@judgment_after
select json_build_object(
  'owner', j.owner_id, 'status', j.status, 'finalized_by', j.finalized_by,
  'content_text', j.content_text,
  'versions', (select count(*) from public.judgment_versions v where v.judgment_id = j.id))
from public.judgments j where j.id = '${JT}';
\\echo @@transfers
select coalesce(json_agg(json_build_object(
  'from', t.from_owner_id, 'to', t.to_owner_id, 'original', t.original_author_id,
  'by', t.transferred_by, 'court', t.court_id, 'reason', t.reason)), '[]')
from public.judgment_ownership_transfers t where t.judgment_id = '${JT}';
\\echo @@transfer_audit
select coalesce(json_agg(json_build_object(
  'actor', a.actor_id, 'event', a.new_data ->> 'event',
  'old_owner', a.old_data ->> 'owner_id', 'new_owner', a.new_data ->> 'owner_id') order by a.id), '[]')
from public.audit_log a
where a.table_name = 'judgments' and a.record_id = '${JT}' and a.action = 'update'
  and (a.new_data ? 'event' or a.old_data ->> 'owner_id' is distinct from a.new_data ->> 'owner_id');
\\echo @@notices
select coalesce(json_agg(json_build_object('user', n.user_id, 'link', n.link) order by n.link collate "C"), '[]')
from public.notifications n
where n.type = 'judgment_transferred' and n.link like '%${JT}';

${as(T)}
set local role authenticated;
\\echo @@direct_update
select pg_temp.outcome($q$update public.judgments set owner_id = '${M}' where id = '${JT}'$q$);
reset role;
set local role service_role;
\\echo @@service_update
select pg_temp.outcome($q$update public.judgments set owner_id = '${M}' where id = '${JT}'$q$);
reset role;

${as(A)}
set local role authenticated;
\\echo @@t_second
${transfer(O, C, "BE26 second hand-over")} ->> 'original_author_id';
reset role;

${as(M)}
set local role authenticated;
\\echo @@seen_by_author
select count(*) from public.judgment_ownership_transfers where judgment_id = '${JT}';
reset role;
${as(X)}
set local role authenticated;
\\echo @@seen_by_stranger
select count(*) from public.judgment_ownership_transfers where judgment_id = '${JT}';
reset role;
${as(A)}
set local role authenticated;
\\echo @@seen_by_admin
select count(*) from public.judgment_ownership_transfers where judgment_id = '${JT}';
reset role;
rollback;
`;

const sorted = (values) => [...values].sort();

try {
  const out = sections(runSql(script, "test-court-handover"));

  const self = JSON.parse(out.pre_self);
  check(
    "BE-26 pre-flight lists the two un-retained part-heard matters, latest first",
    self.part_heard_unretained.map((r) => r.docket_matter_id),
    [m[4], m[1]],
  );
  check("BE-26 pre-flight counts them", self.part_heard_unretained_count, 2);
  check(
    "BE-26 the magistrate sees their case numbers",
    self.part_heard_unretained.map((r) => r.case_number),
    [`BE26-4-${tag}`, `BE26-1-${tag}`],
  );
  check(
    "BE-26 pre-flight lists the four pins",
    sorted(self.pinned_judgments.map((p) => p.pin_id)),
    sorted([P1, P2, P3, P4]),
  );
  check(
    "BE-26 only the private, unshared pin on a matter they lose will unlink",
    Object.fromEntries(self.pinned_judgments.map((p) => [p.pin_id, p.will_unlink])),
    Object.fromEntries(sorted([P1, P2, P3, P4]).map((p) => [p, p === P1])),
  );
  check(
    "BE-26 pre-flight counts pins and pins to unlink",
    [self.pinned_judgment_count, self.pins_to_unlink_count, self.ended],
    [4, 1, false],
  );
  check(
    "BE-26 the magistrate sees their judgment titles",
    self.pinned_judgments.find((p) => p.pin_id === P1)?.judgment_title,
    "BE26 Private",
  );

  const admin = JSON.parse(out.pre_admin);
  check(
    "BE-26 an administrator gets the same counts",
    [admin.part_heard_unretained_count, admin.pinned_judgment_count, admin.pins_to_unlink_count],
    [2, 4, 1],
  );
  check(
    "BE-26 an administrator gets no case number or matter title",
    sorted(new Set(admin.part_heard_unretained.flatMap((r) => Object.keys(r)))),
    ["docket_matter_id", "last_heard_on", "status"],
  );
  check(
    "BE-26 an administrator gets no judgment title",
    admin.pinned_judgments.some((p) => "judgment_title" in p),
    false,
  );
  check("BE-26 another magistrate cannot run the pre-flight", out.pre_other, "42501");

  check("BE-26 the magistrate relinquishes the court", out.relinquished, "t");
  check(
    "BE-26 relinquishing unlinks only the pin nobody else can see",
    JSON.parse(out.pins_after_relinquish),
    sorted([P2, P3, P4]),
  );
  check("BE-26 the unlink is audited", JSON.parse(out.unlink_audit), [
    {
      record_id: P1,
      action: "delete",
      actor: M,
      event: "judgment_pin_unlinked",
      reason: "court_assignment_ended",
      judgment_id: J1,
    },
  ]);
  check(
    "BE-26 ending the retained assignment unlinks the pin on that matter",
    JSON.parse(out.pins_after_retained_end),
    sorted([P2, P3]),
  );
  check("BE-26 the owner counts a pin left behind", out.dry_run, "1");
  check("BE-26 counting unlinks nothing", JSON.parse(out.pins_after_dry_run), sorted([P2, P3]));
  check("BE-26 the owner unlinks it", out.unlinked, "1");
  check("BE-26 the discoverable pin stays", JSON.parse(out.pins_final), [P2]);

  check("BE-26 a magistrate cannot transfer a judgment", out.t_not_admin, "42501");
  check("BE-26 not to a magistrate of another court", out.t_target_elsewhere, "P0001");
  check("BE-26 not through a court the owner never sat", out.t_owner_never_sat, "P0001");
  check("BE-26 not to an inactive magistrate", out.t_inactive, "P0001");
  check("BE-26 not without a reason", out.t_no_reason, "22023");
  check("BE-26 not to the current owner", out.t_same_owner, "22023");

  const result = JSON.parse(out.t_ok);
  check("BE-26 the transfer returns ids only", Object.keys(result).sort(), [
    "court_id",
    "from_owner_id",
    "judgment_id",
    "original_author_id",
    "to_owner_id",
    "transfer_id",
    "transferred_at",
  ]);
  check(
    "BE-26 from the departed magistrate to the successor, authored by the first",
    [result.from_owner_id, result.to_owner_id, result.original_author_id],
    [M, T, M],
  );
  check("BE-26 only the owner changes", JSON.parse(out.judgment_after), {
    owner: T,
    status: "final",
    finalized_by: M,
    content_text: "BE26 transfer body",
    versions: 0,
  });
  check("BE-26 the transfer is recorded with the original author", JSON.parse(out.transfers), [
    { from: M, to: T, original: M, by: A, court: C, reason: "BE26 hand-over" },
  ]);
  check("BE-26 the transfer is audited", JSON.parse(out.transfer_audit), [
    { actor: A, event: null, old_owner: M, new_owner: T },
    { actor: A, event: "judgment_ownership_transferred", old_owner: null, new_owner: null },
  ]);
  check("BE-26 both magistrates are notified", JSON.parse(out.notices), [
    { user: T, link: `/judgments/${JT}` },
    { user: M, link: `/judgments?transferred=${JT}` },
  ]);
  check("BE-26 the new owner cannot change owner_id directly", out.direct_update, "42501");
  check("BE-26 nor can the service role", out.service_update, "42501");
  check("BE-26 a second transfer keeps the original author", out.t_second, M);
  check("BE-26 the original author sees both transfers", out.seen_by_author, "2");
  check("BE-26 another magistrate sees none", out.seen_by_stranger, "0");
  check("BE-26 an administrator sees both", out.seen_by_admin, "2");
} catch (error) {
  console.error(error);
  failures += 1;
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll checks passed");
