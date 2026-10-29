-- Magistrate Wizard -- 0221: the subject-access export holds everything a person owns
--
-- Problem (backend sweep BE-19)
--   download_my_data() (0137) strips the content of judgments, bench notes
--   and personal case law, and leaves out quick codes, comments, case-law
--   annotations, document metadata, the person's sign-in events and more.
--   A data-subject request cannot be answered from the product.
--
-- Change
--   download_my_data() keeps its rate limit (5 a minute) and its checks,
--   and returns every row that belongs to the caller, with its content:
--     profile                       (as before, without avatar_url)
--     judgments                     owned, with content and content_text
--     judgment_versions             of owned judgments, with content
--     judgment_tags                 on owned judgments, or written by the caller
--     judgment_docket_links         pins of owned judgments, or made by the caller
--     judgment_ownership_transfers  where the caller is a party (0220)
--     bench_notes                   authored, with content
--     bench_note_tags               on authored bench notes, with the tag name
--     comments                      authored
--     case_law                      personal research owned, with full text
--     case_law_tags                 on owned case law, with the tag name
--     case_law_annotations          owned
--     quick_codes                   owned, with content
--     quick_code_judgments, quick_code_docket_matters, quick_code_case_law
--                                   links of owned codes, or made by the caller
--     bookmarks, shares (granted or received), notifications
--     documents                     uploaded, metadata (the files stay in storage)
--     clerk_access_requests, clerk_courts,
--     magistrate_court_requests, magistrate_courts
--     docket_matter_assignments     the caller's retained assignments
--     docket_capacity_settings, docket_capacity_overrides (about the caller),
--     docket_event_calendar_links
--     issue_reports                 reported
--     auth_events                   sign-in events recorded for the caller,
--                                   including failed sign-ins with their email
--     activity                      the caller's audit_log rows: when, what
--                                   action, on which table and record id
--     rpc_rate_limits               the caller's rate-limit counters
--   Only search_vector (derived) is left out of a row.
--
--   Not exported: court and library records the caller only created or
--   stamped (docket matters, sittings, parties, callovers, statutes,
--   canonical case law, imports, tags, webhooks, retention settings). They
--   belong to the court or the library, and may hold other people's data
--   the caller can no longer see; `activity` lists what the caller did to
--   them without their content. scripts/tests/test-subject-access-export.mjs
--   classifies every foreign key to profiles as exported or provenance, so a
--   new one fails until it is classified.
--
--   Held (owner decision, not built here): erasing or anonymising a
--   departed person. It deletes data and depends on a retention policy the
--   owner has not set.
--
-- Threat model
--   Still SECURITY DEFINER with a fixed search_path, and every query keys
--   on auth.uid(): a row is exported only when the caller owns, authored,
--   holds, received or is the subject of it. Content of someone else's
--   judgment or note never comes back: versions are exported only for
--   judgments the caller owns, and activity carries no old or new values.
--   EXECUTE stays with authenticated only (0138).
-- ============================================================================

create or replace function public.download_my_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_email text;
begin
  perform public.enforce_rpc_rate_limit('download_my_data', 5, 60);
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select lower(p.email) into v_email from public.profiles p where p.id = uid;

  return jsonb_build_object(
    'exported_at', now(),
    'profile', (
      select to_jsonb(p) - 'avatar_url'
      from public.profiles p
      where p.id = uid
    ),
    'judgments', coalesce((
      select jsonb_agg(to_jsonb(j) - 'search_vector' order by j.updated_at desc, j.id)
      from public.judgments j
      where j.owner_id = uid
    ), '[]'::jsonb),
    'judgment_versions', coalesce((
      select jsonb_agg(to_jsonb(v) order by v.judgment_id, v.version_number)
      from public.judgment_versions v
      join public.judgments j on j.id = v.judgment_id
      where j.owner_id = uid
    ), '[]'::jsonb),
    'judgment_tags', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.created_at, t.id)
      from public.judgment_tags t
      where t.created_by = uid
        or exists (select 1 from public.judgments j where j.id = t.judgment_id and j.owner_id = uid)
    ), '[]'::jsonb),
    'judgment_docket_links', coalesce((
      select jsonb_agg(to_jsonb(l) order by l.created_at, l.id)
      from public.docket_matter_judgments l
      where l.created_by = uid
        or exists (select 1 from public.judgments j where j.id = l.judgment_id and j.owner_id = uid)
    ), '[]'::jsonb),
    'judgment_ownership_transfers', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.created_at, t.id)
      from public.judgment_ownership_transfers t
      where uid in (t.from_owner_id, t.to_owner_id, t.original_author_id, t.transferred_by)
    ), '[]'::jsonb),
    'bench_notes', coalesce((
      select jsonb_agg(to_jsonb(b) - 'search_vector' order by b.updated_at desc, b.id)
      from public.bench_notes b
      where b.author_id = uid
    ), '[]'::jsonb),
    'bench_note_tags', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'bench_note_id', bt.bench_note_id,
          'tag_id', bt.tag_id,
          'tag_name', tg.name,
          'created_at', bt.created_at
        )
        order by bt.created_at, bt.bench_note_id, bt.tag_id
      )
      from public.bench_note_tags bt
      join public.bench_notes b on b.id = bt.bench_note_id
      join public.tags tg on tg.id = bt.tag_id
      where b.author_id = uid
    ), '[]'::jsonb),
    'comments', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.created_at, c.id)
      from public.comments c
      where c.author_id = uid
    ), '[]'::jsonb),
    'case_law', coalesce((
      select jsonb_agg(to_jsonb(c) - 'search_vector' order by c.updated_at desc, c.id)
      from public.case_law c
      where c.owner_id = uid
    ), '[]'::jsonb),
    'case_law_tags', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'case_law_id', ct.case_law_id,
          'tag_id', ct.tag_id,
          'tag_name', tg.name,
          'created_at', ct.created_at
        )
        order by ct.created_at, ct.case_law_id, ct.tag_id
      )
      from public.case_law_tags ct
      join public.case_law c on c.id = ct.case_law_id
      join public.tags tg on tg.id = ct.tag_id
      where c.owner_id = uid
    ), '[]'::jsonb),
    'case_law_annotations', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.created_at, a.id)
      from public.case_law_annotations a
      where a.owner_id = uid
    ), '[]'::jsonb),
    'quick_codes', coalesce((
      select jsonb_agg(to_jsonb(q) - 'search_vector' order by q.updated_at desc, q.id)
      from public.quick_codes q
      where q.owner_id = uid
    ), '[]'::jsonb),
    'quick_code_judgments', coalesce((
      select jsonb_agg(to_jsonb(l) order by l.created_at, l.id)
      from public.quick_code_judgments l
      where l.created_by = uid
        or exists (select 1 from public.quick_codes q where q.id = l.quick_code_id and q.owner_id = uid)
    ), '[]'::jsonb),
    'quick_code_docket_matters', coalesce((
      select jsonb_agg(to_jsonb(l) order by l.created_at, l.id)
      from public.quick_code_docket_matters l
      where l.created_by = uid
        or exists (select 1 from public.quick_codes q where q.id = l.quick_code_id and q.owner_id = uid)
    ), '[]'::jsonb),
    'quick_code_case_law', coalesce((
      select jsonb_agg(to_jsonb(l) order by l.created_at, l.id)
      from public.quick_code_case_law l
      where l.created_by = uid
        or exists (select 1 from public.quick_codes q where q.id = l.quick_code_id and q.owner_id = uid)
    ), '[]'::jsonb),
    'bookmarks', coalesce((
      select jsonb_agg(to_jsonb(b) order by b.created_at desc, b.id)
      from public.bookmarks b
      where b.user_id = uid
    ), '[]'::jsonb),
    'shares', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.created_at desc, s.id)
      from public.shares s
      where s.granted_by = uid or s.recipient_id = uid
    ), '[]'::jsonb),
    'notifications', coalesce((
      select jsonb_agg(to_jsonb(n) order by n.created_at desc, n.id)
      from public.notifications n
      where n.user_id = uid
    ), '[]'::jsonb),
    'documents', coalesce((
      select jsonb_agg(to_jsonb(d) order by d.created_at desc, d.id)
      from public.documents d
      where d.uploaded_by = uid
    ), '[]'::jsonb),
    'clerk_access_requests', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.created_at desc, r.id)
      from public.clerk_access_requests r
      where r.profile_id = uid
    ), '[]'::jsonb),
    'clerk_courts', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.started_at desc, c.id)
      from public.clerk_courts c
      where c.profile_id = uid
    ), '[]'::jsonb),
    'magistrate_court_requests', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.created_at desc, r.id)
      from public.magistrate_court_requests r
      where r.profile_id = uid
    ), '[]'::jsonb),
    'magistrate_courts', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.started_at desc, m.id)
      from public.magistrate_courts m
      where m.profile_id = uid
    ), '[]'::jsonb),
    'docket_matter_assignments', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.started_at desc, a.id)
      from public.docket_matter_assignments a
      where a.profile_id = uid
    ), '[]'::jsonb),
    'docket_capacity_settings', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.created_at, s.id)
      from public.docket_capacity_settings s
      where s.owner_id = uid
    ), '[]'::jsonb),
    'docket_capacity_overrides', coalesce((
      select jsonb_agg(to_jsonb(o) order by o.created_at desc, o.id)
      from public.docket_capacity_overrides o
      where o.magistrate_profile_id = uid
    ), '[]'::jsonb),
    'docket_event_calendar_links', coalesce((
      select jsonb_agg(to_jsonb(l) order by l.created_at desc, l.id)
      from public.docket_event_calendar_links l
      where l.profile_id = uid
    ), '[]'::jsonb),
    'issue_reports', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.created_at desc, r.id)
      from public.issue_reports r
      where r.reporter_id = uid
    ), '[]'::jsonb),
    'auth_events', coalesce((
      select jsonb_agg(to_jsonb(e) order by e.created_at desc, e.id)
      from (
        select a.* from public.auth_event_log a where a.actor_id = uid
        union all
        select a.* from public.auth_event_log a
        where a.actor_id is null
          and a.event_type = any (enum_range(null::public.auth_event_type))
          and a.email = v_email
      ) e
    ), '[]'::jsonb),
    'activity', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'created_at', a.created_at,
          'action', a.action,
          'table_name', a.table_name,
          'record_id', a.record_id
        )
        order by a.id
      )
      from public.audit_log a
      where a.actor_id = uid
    ), '[]'::jsonb),
    'rpc_rate_limits', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.window_start desc, r.rpc_name)
      from public.rpc_rate_limit_buckets r
      where r.user_id = uid
    ), '[]'::jsonb)
  );
end;
$$;

comment on function public.download_my_data() is
  'JSON export of everything the caller owns, authored, holds, received or is the subject of, with its content (0221, BE-19): profile, judgments and their versions, tags, pins and transfers, bench notes, comments, personal case law and annotations, quick codes and their links, bookmarks, shares, notifications, document metadata, court requests and assignments, retained assignments, capacity settings, calendar links, issue reports, sign-in events, the caller''s audit_log activity (no values) and rate-limit counters. Court and library records the caller only created are not exported. enforce_rpc_rate_limit 5/60s (0137).';
