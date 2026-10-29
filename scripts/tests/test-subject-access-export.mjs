// @live-db  opens a real Supabase connection: `npm test` skips it, `npm run test:live` includes it
/**
 * The subject-access export holds everything a person owns (0221), on a
 * real database.
 *
 *   BE-19  every foreign key to profiles is classified below as exported
 *          (with the export key that carries it) or as provenance on a
 *          court or library record, so a new one fails until someone
 *          decides. Then, inside one transaction that is rolled back, a
 *          fixture magistrate gets a row in every exported table, a second
 *          magistrate gets private rows of their own, and the first calls
 *          download_my_data():
 *          - every export key is present and holds the fixture's row;
 *          - content comes back: judgment, version, bench note, case law,
 *            annotation, quick code, comment and issue report text, and
 *            document metadata;
 *          - sign-in events include a failed sign-in recorded only by email;
 *          - activity lists the fixture's audit rows without their values;
 *          - nothing of the second magistrate's comes back.
 *
 * Needs `psql` and the local stack (`npm run db:start`); nothing persists.
 *
 *   npm run test:subject-access-export
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

/**
 * Every `<table>.<column>` with a foreign key to profiles(id). Exported ones
 * name the download_my_data() key that carries the person's rows; the rest
 * stamp a court or library record the person does not own, and the
 * export's `activity` lists what they did to it.
 */
const EXPORTED = {
  "audit_log.actor_id": "activity",
  "auth_event_log.actor_id": "auth_events",
  "bench_notes.author_id": "bench_notes",
  "bookmarks.user_id": "bookmarks",
  "case_law.owner_id": "case_law",
  "case_law_annotations.owner_id": "case_law_annotations",
  "clerk_access_requests.profile_id": "clerk_access_requests",
  "clerk_courts.profile_id": "clerk_courts",
  "comments.author_id": "comments",
  "docket_capacity_overrides.magistrate_profile_id": "docket_capacity_overrides",
  "docket_capacity_settings.owner_id": "docket_capacity_settings",
  "docket_event_calendar_links.profile_id": "docket_event_calendar_links",
  "docket_matter_assignments.profile_id": "docket_matter_assignments",
  "docket_matter_judgments.created_by": "judgment_docket_links",
  "documents.uploaded_by": "documents",
  "issue_reports.reporter_id": "issue_reports",
  "judgment_ownership_transfers.from_owner_id": "judgment_ownership_transfers",
  "judgment_ownership_transfers.original_author_id": "judgment_ownership_transfers",
  "judgment_ownership_transfers.to_owner_id": "judgment_ownership_transfers",
  "judgment_ownership_transfers.transferred_by": "judgment_ownership_transfers",
  "judgment_tags.created_by": "judgment_tags",
  "judgment_versions.created_by": "judgment_versions",
  "judgments.owner_id": "judgments",
  "magistrate_court_requests.profile_id": "magistrate_court_requests",
  "magistrate_courts.profile_id": "magistrate_courts",
  "notifications.user_id": "notifications",
  "quick_code_case_law.created_by": "quick_code_case_law",
  "quick_code_docket_matters.created_by": "quick_code_docket_matters",
  "quick_code_judgments.created_by": "quick_code_judgments",
  "quick_codes.owner_id": "quick_codes",
  "shares.granted_by": "shares",
  "shares.recipient_id": "shares",
};

const PROVENANCE = new Set([
  "case_law.created_by",
  "cases.assigned_magistrate_id",
  "cases.created_by",
  "clerk_access_requests.reviewed_by",
  "clerk_courts.approved_by",
  "clerk_courts.ended_by",
  "court_non_sitting_days.created_by",
  "court_non_sitting_days.last_updated_by",
  "data_retention_policies.updated_by",
  "docket_callover_items.created_by",
  "docket_callover_items.last_updated_by",
  "docket_callovers.created_by",
  "docket_callovers.last_updated_by",
  "docket_capacity_overrides.overridden_by",
  "docket_events.created_by",
  "docket_events.last_updated_by",
  "docket_events.presiding_magistrate_id",
  "docket_matter_assignments.granted_by",
  "docket_matter_case_law.created_by",
  "docket_matter_parties.created_by",
  "docket_matter_parties.last_updated_by",
  "docket_matter_tags.created_by",
  "docket_matters.created_by",
  "docket_matters.deleted_by",
  "docket_matters.last_updated_by",
  "feature_flags.updated_by",
  "import_batches.created_by",
  "import_jobs.created_by",
  "issue_reports.resolved_by",
  "judgments.finalized_by",
  "legal_sources.created_by",
  "magistrate_court_requests.reviewed_by",
  "magistrate_courts.ended_by",
  "statutes.created_by",
  "tags.created_by",
  "webhook_endpoints.created_by",
]);

/** Keys with no foreign key to profiles behind them. */
const OTHER_KEYS = [
  "exported_at",
  "profile",
  "bench_note_tags",
  "case_law_tags",
  "rpc_rate_limits",
];

const EXPECTED_KEYS = [...new Set([...Object.values(EXPORTED), ...OTHER_KEYS])].sort();

const tag = randomUUID().slice(0, 8);
const id = () => randomUUID();
const U = id();
const V = id();
const emailU = `be19-owner-${tag}@example.test`;
const emailV = `be19-other-${tag}@example.test`;
const district = id();
const court = id();
const otherCourt = id();
const category = id();
const tagRow = id();
const J = id();
const JV = id();
const DM = id();
const BN = id();
const BNV = id();
const CL = id();
const QC = id();
const QCV = id();
const E = id();
const claims = (sub) => JSON.stringify({ sub, role: "authenticated" });

const script = `begin;
\\echo @@fks
select coalesce(json_agg(cl.relname || '.' || a.attname order by cl.relname, a.attname), '[]')
from pg_constraint con
join pg_class cl on cl.oid = con.conrelid
join pg_namespace n on n.oid = cl.relnamespace
join pg_attribute a on a.attrelid = con.conrelid and a.attnum = any (con.conkey)
where con.contype = 'f'
  and con.confrelid = 'public.profiles'::regclass
  and n.nspname = 'public';

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token)
values ('00000000-0000-0000-0000-000000000000', '${U}', 'authenticated', 'authenticated',
  '${emailU}', '', now(), '{"provider":"email","providers":["email"]}',
  '{"full_name":"BE19 Owner"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '${V}', 'authenticated', 'authenticated',
  '${emailV}', '', now(), '{"provider":"email","providers":["email"]}',
  '{"full_name":"BE19 Other"}', now(), now(), '', '', '', '');
update public.profiles set role = 'magistrate' where id in ('${U}', '${V}');
insert into public.magisterial_districts (id, name) values ('${district}', 'BE19 District ${tag}');
insert into public.courts (id, name, jurisdiction, district_id, is_active)
values ('${court}', 'BE19 Court ${tag}', 'Test', '${district}', true),
       ('${otherCourt}', 'BE19 Other Court ${tag}', 'Test', '${district}', true);
insert into public.magistrate_courts (profile_id, court_id, assignment_type)
values ('${U}', '${court}', 'regular'), ('${V}', '${court}', 'acting');
insert into public.docket_matter_categories (id, name) values ('${category}', 'BE19 Category ${tag}');
insert into public.tags (id, name) values ('${tagRow}', 'be19-tag-${tag}');

-- The owner's rows, written as the owner so every guard sees them.
set local request.jwt.claims = '${claims(U)}';
insert into public.judgments (id, title, content, content_text)
values ('${J}', 'BE19 Judgment', '{"text": "BE19 judgment body"}', 'BE19 judgment body');
update public.judgments set title = 'BE19 Judgment revised' where id = '${J}';
insert into public.judgment_tags (judgment_id, tag_name) values ('${J}', 'be19-judgment-tag');
insert into public.docket_matters (id, court_id, district_id, case_number, matter_title)
values ('${DM}', '${court}', '${district}', 'BE19-${tag}/2026', 'BE19 Matter');
insert into public.docket_matter_judgments (docket_matter_id, judgment_id) values ('${DM}', '${J}');
insert into public.bench_notes (id, title, content, content_text, entity_type, entity_id)
values ('${BN}', 'BE19 Note', '{"text": "BE19 note body"}', 'BE19 note body', 'judgment', '${J}');
insert into public.bench_note_tags (bench_note_id, tag_id) values ('${BN}', '${tagRow}');
insert into public.comments (author_id, bench_note_id, content) values ('${U}', '${BN}', 'BE19 comment body');
insert into public.case_law (id, case_name, citation, court, jurisdiction, owner_id, summary, full_text, key_passages)
values ('${CL}', 'BE19 v Research', '[2026] BE19 ${tag}', 'Fixture Court', 'Fixture', '${U}',
  'BE19 summary', 'BE19 full text', 'BE19 key passage');
insert into public.case_law_tags (case_law_id, tag_id) values ('${CL}', '${tagRow}');
insert into public.case_law_annotations (case_law_id, annotation_text) values ('${CL}', 'BE19 annotation');
insert into public.quick_codes (id, code_word, content) values ('${QC}', 'be19code${tag}', 'BE19 quick code body');
insert into public.quick_code_judgments (quick_code_id, judgment_id) values ('${QC}', '${J}');
insert into public.quick_code_docket_matters (quick_code_id, docket_matter_id) values ('${QC}', '${DM}');
insert into public.quick_code_case_law (quick_code_id, case_law_id) values ('${QC}', '${CL}');
insert into public.bookmarks (user_id, entity_type, entity_id) values ('${U}', 'judgment', '${J}');
insert into public.shares (item_type, item_id, recipient_id, permission) values ('judgment', '${J}', '${V}', 'view');
insert into public.notifications (user_id, type, title) values ('${U}', 'stale_draft', 'BE19 notice');
insert into public.documents (uploaded_by, file_name, file_path, file_size, mime_type, entity_type, entity_id)
values ('${U}', 'be19-attachment.pdf', 'judgment/${J}/be19-attachment.pdf', 10, 'application/pdf', 'judgment', '${J}');
insert into public.clerk_access_requests (profile_id, court_id, note) values ('${U}', '${otherCourt}', 'BE19 clerk request');
insert into public.clerk_courts (profile_id, court_id, approved_by) values ('${U}', '${otherCourt}', '${V}');
insert into public.magistrate_court_requests (profile_id, court_id, note) values ('${U}', '${otherCourt}', 'BE19 court request');
insert into public.docket_matter_assignments (docket_matter_id) values ('${DM}');
insert into public.docket_capacity_settings (category_id, daily_capacity) values ('${category}', 4);
insert into public.docket_events (id, docket_matter_id, scheduled_date) values ('${E}', '${DM}', current_date);
insert into public.docket_capacity_overrides (docket_event_id, docket_matter_id, category_id, magistrate_profile_id,
  scheduled_date, configured_capacity, scheduled_count_at_override, reason, overridden_by)
values ('${E}', '${DM}', '${category}', '${U}', current_date, 4, 5, 'BE19 override reason', '${U}');
insert into public.docket_event_calendar_links (docket_event_id, provider, external_calendar_id, external_event_id)
values ('${E}', 'google', 'be19-calendar', 'be19-event');
insert into public.issue_reports (reporter_id, type, title, description)
values ('${U}', 'bug', 'BE19 issue', 'BE19 issue description');
insert into public.auth_event_log (event_type, actor_id, email)
values ('logout', '${U}', '${emailU}'), ('login_failed', null, '${emailU}');
insert into public.judgment_ownership_transfers (judgment_id, from_owner_id, to_owner_id, original_author_id,
  transferred_by, court_id, reason)
values ('${J}', '${V}', '${U}', '${V}', '${V}', '${court}', 'BE19 transfer reason');

-- The other magistrate's private rows, which must not come back.
set local request.jwt.claims = '${claims(V)}';
insert into public.judgments (id, title, content_text) values ('${JV}', 'BE19 Other', 'BE19 other body');
insert into public.bench_notes (id, title, content_text, entity_type, entity_id)
values ('${BNV}', 'BE19 Other Note', 'BE19 other note body', 'judgment', '${JV}');
insert into public.quick_codes (id, code_word, content) values ('${QCV}', 'be19other${tag}', 'BE19 other code');
insert into public.notifications (user_id, type, title) values ('${V}', 'stale_draft', 'BE19 other notice');
insert into public.auth_event_log (event_type, actor_id, email) values ('logout', '${V}', '${emailV}');

set local request.jwt.claims = '${claims(U)}';
set local role authenticated;
\\echo @@export
select public.download_my_data();
reset role;
rollback;
`;

const ids = (rows, key = "id") => (rows ?? []).map((r) => r[key]);
const has = (rows, key, value) => (rows ?? []).some((r) => r[key] === value);

try {
  const out = sections(runSql(script, "test-subject-access-export"));
  const fks = JSON.parse(out.fks);
  const classified = new Set([...Object.keys(EXPORTED), ...PROVENANCE]);
  check(
    "BE-19 every foreign key to profiles is classified as exported or provenance",
    fks.filter((fk) => !classified.has(fk)),
    [],
  );
  check(
    "BE-19 the classification names no foreign key that no longer exists",
    [...classified].filter((fk) => !fks.includes(fk)),
    [],
  );

  const x = JSON.parse(out.export);
  check("BE-19 the export has every key, and no other", Object.keys(x).sort(), EXPECTED_KEYS);

  check(
    "BE-19 profile is the caller's, without avatar_url",
    [x.profile?.id, "avatar_url" in (x.profile ?? {})],
    [U, false],
  );

  const j = (x.judgments ?? []).find((r) => r.id === J);
  check(
    "BE-19 judgments carry their content",
    [j?.title, j?.content_text, j?.content?.text, "search_vector" in (j ?? {})],
    ["BE19 Judgment revised", "BE19 judgment body", "BE19 judgment body", false],
  );
  check("BE-19 judgments hold only the caller's", ids(x.judgments), [J]);
  check(
    "BE-19 judgment_versions carry the earlier content",
    (x.judgment_versions ?? []).map((v) => [
      v.judgment_id,
      v.version_number,
      v.title,
      v.content_text,
    ]),
    [[J, 1, "BE19 Judgment", "BE19 judgment body"]],
  );
  check("BE-19 judgment_tags", ids(x.judgment_tags, "tag_name"), ["be19-judgment-tag"]);
  check(
    "BE-19 judgment_docket_links",
    (x.judgment_docket_links ?? []).map((l) => [l.docket_matter_id, l.judgment_id]),
    [[DM, J]],
  );
  check("BE-19 judgment_ownership_transfers", ids(x.judgment_ownership_transfers, "reason"), [
    "BE19 transfer reason",
  ]);

  const bn = (x.bench_notes ?? []).find((r) => r.id === BN);
  check(
    "BE-19 bench_notes carry their content",
    [bn?.content_text, bn?.content?.text, "search_vector" in (bn ?? {})],
    ["BE19 note body", "BE19 note body", false],
  );
  check("BE-19 bench_notes hold only the caller's", ids(x.bench_notes), [BN]);
  check("BE-19 bench_note_tags carry the tag name", ids(x.bench_note_tags, "tag_name"), [
    `be19-tag-${tag}`,
  ]);
  check("BE-19 comments carry their content", ids(x.comments, "content"), ["BE19 comment body"]);

  const cl = (x.case_law ?? []).find((r) => r.id === CL);
  check(
    "BE-19 case_law carries its full text",
    [cl?.summary, cl?.full_text, cl?.key_passages, "search_vector" in (cl ?? {})],
    ["BE19 summary", "BE19 full text", "BE19 key passage", false],
  );
  check("BE-19 case_law_tags carry the tag name", ids(x.case_law_tags, "tag_name"), [
    `be19-tag-${tag}`,
  ]);
  check(
    "BE-19 case_law_annotations carry their text",
    ids(x.case_law_annotations, "annotation_text"),
    ["BE19 annotation"],
  );

  const qc = (x.quick_codes ?? []).find((r) => r.id === QC);
  check(
    "BE-19 quick_codes carry their content",
    [qc?.content, "search_vector" in (qc ?? {})],
    ["BE19 quick code body", false],
  );
  check("BE-19 quick_codes hold only the caller's", ids(x.quick_codes), [QC]);
  check("BE-19 quick_code_judgments", ids(x.quick_code_judgments, "judgment_id"), [J]);
  check("BE-19 quick_code_docket_matters", ids(x.quick_code_docket_matters, "docket_matter_id"), [
    DM,
  ]);
  check("BE-19 quick_code_case_law", ids(x.quick_code_case_law, "case_law_id"), [CL]);

  check("BE-19 bookmarks", ids(x.bookmarks, "entity_id"), [J]);
  check(
    "BE-19 shares the caller granted",
    (x.shares ?? []).map((s) => [s.item_id, s.granted_by, s.recipient_id]),
    [[J, U, V]],
  );
  check(
    "BE-19 notifications hold the caller's, not the other magistrate's",
    [
      has(x.notifications, "title", "BE19 notice"),
      has(x.notifications, "title", "BE19 other notice"),
    ],
    [true, false],
  );
  check(
    "BE-19 documents carry their metadata",
    (x.documents ?? []).map((d) => [d.file_name, d.mime_type, d.entity_id]),
    [["be19-attachment.pdf", "application/pdf", J]],
  );
  check("BE-19 clerk_access_requests", ids(x.clerk_access_requests, "note"), [
    "BE19 clerk request",
  ]);
  check("BE-19 clerk_courts", ids(x.clerk_courts, "court_id"), [otherCourt]);
  check("BE-19 magistrate_court_requests", ids(x.magistrate_court_requests, "note"), [
    "BE19 court request",
  ]);
  check("BE-19 magistrate_courts", ids(x.magistrate_courts, "court_id"), [court]);
  check("BE-19 docket_matter_assignments", ids(x.docket_matter_assignments, "docket_matter_id"), [
    DM,
  ]);
  check("BE-19 docket_capacity_settings", ids(x.docket_capacity_settings, "daily_capacity"), [4]);
  check("BE-19 docket_capacity_overrides", ids(x.docket_capacity_overrides, "reason"), [
    "BE19 override reason",
  ]);
  check(
    "BE-19 docket_event_calendar_links",
    ids(x.docket_event_calendar_links, "external_event_id"),
    ["be19-event"],
  );
  check("BE-19 issue_reports carry their description", ids(x.issue_reports, "description"), [
    "BE19 issue description",
  ]);
  check(
    "BE-19 auth_events hold the caller's, including a failed sign-in by email",
    (x.auth_events ?? []).map((e) => [e.event_type, e.actor_id, e.email]).sort(),
    [
      ["login_failed", null, emailU],
      ["logout", U, emailU],
    ],
  );
  check(
    "BE-19 activity lists the caller's audit rows",
    has(x.activity, "record_id", J) && has(x.activity, "table_name", "judgments"),
    true,
  );
  check(
    "BE-19 activity carries no values",
    [...new Set((x.activity ?? []).flatMap((a) => Object.keys(a)))].sort(),
    ["action", "created_at", "id", "record_id", "table_name"],
  );
  check(
    "BE-19 rpc_rate_limits include this export",
    has(x.rpc_rate_limits, "rpc_name", "download_my_data"),
    true,
  );

  const text = out.export;
  check(
    "BE-19 nothing of the other magistrate's private rows comes back",
    [JV, BNV, QCV, "BE19 other body", "BE19 other note body", "BE19 other code", emailV].filter(
      (s) => text.includes(s),
    ),
    [],
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
