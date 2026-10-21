-- ============================================================================
-- 0165_storage_sharing_and_notifications.sql
--
-- Forward-only fixes for Storage, sharing and notifications, from the
-- 2026-10-15 agentic audit (theme T6: C-04, C-09, B-13, B-15, B-16, C-11).
-- No invariant in docs/adr/ is reopened and no admin path is added.
--
-- 1. C-04: deleting a judgment, bench note, quick code or Case Law entry
--    removed only its `documents` rows (documents_parent_cascade_delete);
--    the file stayed in Storage. Because a `documents` row could carry any
--    file_path, anyone who knew the path (a revoked share recipient, say)
--    could register a row for it with uploaded_by = self and download it.
--    a. Both documents INSERT policies require file_path to sit in the
--       caller's own Storage folder, the same rule the documents bucket
--       applies to uploads. A row can only point at a file its uploader
--       could have stored, so a path is never claimable by anyone else.
--    b. SQL cannot delete a Storage object (storage.protect_delete refuses
--       it, and the bytes would stay in the object store), so file removal
--       goes through the Storage API. When a `documents` row is deleted
--       while its file is still stored and no other row references it,
--       documents_queue_storage_cleanup() records the path in
--       storage_cleanup_queue, inside the same transaction as the delete.
--       The storage-cleanup Edge Function drains the queue with the
--       service role, the outbox pattern webhook_outbox / webhook-dispatch
--       already use. The client asks for a drain after every delete; a
--       missed or failed drain leaves the path queued for the next one, so
--       a deleted parent never loses track of its files. This also covers
--       files the deleting user cannot remove through the API: an edit-share
--       recipient's attachment, or a preview derivative in a viewer's
--       folder. The useDeleteDocument path removes the file first, so its
--       row delete queues nothing.
-- 2. C-09: resolve_item_share_recipient resolved clerks (and magistrates
--    with no active court) for Judgments and personal Case Law, which they
--    can never open; the recipient was told "shared with you", and on
--    finalisation judgments_notify_final put the private title in their
--    notice.
--    a. can_receive_research_share(profile) is the recipient half of
--       can_view_judgment / can_view_case_law: an active profile that is
--       not a clerk, and a magistrate only while they sit a court.
--    b. The resolver no longer returns anyone else for those item types,
--       and shares_recipient_guard() refuses a direct INSERT to them.
--       Docket shares are unchanged.
--    c. judgments_notify_final notifies only recipients who can currently
--       read the judgment, and spells the notice "finalised".
-- 3. B-13: notify_user dropped a second notice with the same type and link
--    inside 20 hours, so revoke-then-share-again (the only way to change a
--    share's level, ADR 0006) left the recipient's last notice as
--    "revoked". share_granted and share_revoked are no longer deduplicated:
--    each is a real change of access and each one is announced.
-- 4. B-16: useRevokeShare sent the device clock as revoked_at, so a slow
--    clock could not revoke (shares_revoked_after_created) and a fast one
--    stored any future time. shares_guard stamps now() on revoke and
--    ignores the client value. Everything else about the guard is as 0116.
-- 5. B-15: no schema change. docket_matters_district_case_number_unique
--    (0020) is the Magisterial District registry's numbering, so a
--    collision with a matter at another court in the district is refused
--    on purpose; it discloses that a number exists, never the matter. See
--    docs/adr/0009-district-wide-case-numbers.md.
-- 6. C-11: bench_notes_entity_guard (0066) checked only that the parent
--    row existed, as SECURITY DEFINER, so a note pointed at someone else's
--    private judgment was accepted and a random id was refused: an
--    existence oracle. Setting or changing a note's parent now requires
--    the author to be able to see it (can_view_docket_matter / _judgment /
--    _case_law / _statute, or their own draft Act), and an invisible
--    parent gets the same error as a missing one. 0039's rule stands: an
--    ordinary edit never re-checks, so a note survives losing access to,
--    or deletion of, its parent. 0038 let an author attach a new note to a
--    parent they could not see; that is withdrawn because it is exactly
--    the oracle, and no screen offers it.
--
-- Overlap with the open theme migrations 0160-0164: none of them
-- redefines a function, trigger, policy or constraint this file changes.
-- 0160 and 0162 redefine can_view_judgment / can_view_case_law /
-- can_view_statute, which section 6 calls by name, so whichever lands
-- last the bench-note check follows the newest visibility rule. 0161 adds
-- docket_matter_binned / docket_matter_purged to notifications_type_check;
-- this file adds no notification kind and leaves that constraint alone.
-- A matter purged by 0161 cascades its `documents` rows, so its files are
-- queued by section 1b too.
-- ============================================================================

-- ==================== 1a. a documents row points only into its uploader's folder ====================

alter policy "Users can attach documents to accessible parents"
  on public.documents
  with check (
    (uploaded_by = (select auth.uid()))
    and ((storage.foldername(file_path))[1] = (select auth.uid())::text)
    and (
      (entity_type is null)
      or ((entity_type = 'docket_matter') and public.can_edit_docket_matter(entity_id))
      or ((entity_type = 'judgment') and public.can_edit_judgment(entity_id))
      or ((entity_type = 'case_law') and public.can_edit_case_law(entity_id))
      or (
        (entity_type = 'quick_code')
        and exists (
          select 1 from public.quick_codes qc
          where qc.id = documents.entity_id
            and qc.owner_id = (select auth.uid())
        )
      )
      or (
        (entity_type = 'bench_note')
        and exists (
          select 1 from public.bench_notes bn
          where bn.id = documents.entity_id
            and bn.author_id = (select auth.uid())
        )
      )
      or (
        (entity_type = 'case')
        and exists (
          select 1 from public.cases c
          where c.id = documents.entity_id
            and ((select public.is_admin()) or c.court_id = (select public.my_court_id()))
        )
      )
      or (
        (entity_type = 'statute')
        and (
          (select public.is_admin())
          or exists (
            select 1 from public.statutes s
            where s.id = documents.entity_id
              and s.review_status = 'draft'
              and s.created_by = (select auth.uid())
              and (select public.is_magistrate())
          )
        )
      )
    )
  );

alter policy "Users can attach a preview derivative to a document they can vi"
  on public.documents
  with check (
    purpose = 'preview_derivative'
    and uploaded_by = (select auth.uid())
    and (storage.foldername(file_path))[1] = (select auth.uid())::text
    and source_document_id is not null
    and public.can_attach_preview_derivative(source_document_id, entity_type, entity_id)
  );

-- ==================== 1b. files of deleted documents are queued for removal ====================

create table public.storage_cleanup_queue (
  bucket_id text not null,
  object_name text not null,
  queued_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_error text,
  primary key (bucket_id, object_name)
);

comment on table public.storage_cleanup_queue is
  'Storage objects whose documents row was deleted while the file was still stored (0165). Written only by documents_queue_storage_cleanup(); drained by the storage-cleanup Edge Function with the service role, because SQL cannot delete a Storage object. No client role can read or write it.';

alter table public.storage_cleanup_queue enable row level security;

revoke all on table public.storage_cleanup_queue from public, anon, authenticated;
grant select, insert, update, delete on table public.storage_cleanup_queue to service_role;

create or replace function public.documents_queue_storage_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.file_path is null then
    return old;
  end if;

  -- Another row still references the file: it is not an orphan.
  if exists (select 1 from public.documents d where d.file_path = old.file_path) then
    return old;
  end if;

  -- Already removed through the Storage API (useDeleteDocument removes the
  -- file before the row), so there is nothing to clean up.
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'documents' and o.name = old.file_path
  ) then
    return old;
  end if;

  insert into public.storage_cleanup_queue (bucket_id, object_name)
  values ('documents', old.file_path)
  on conflict (bucket_id, object_name) do nothing;

  return old;
end;
$$;

comment on function public.documents_queue_storage_cleanup() is
  'AFTER DELETE on documents (0165). Queues the deleted row''s file in storage_cleanup_queue when it is still stored and no other documents row references it, so a deleted parent never loses track of its files. SECURITY DEFINER: it reads storage.objects and writes the queue, neither of which a client role may touch.';

revoke all on function public.documents_queue_storage_cleanup() from public, anon, authenticated;

create trigger documents_queue_storage_cleanup_trigger
  after delete on public.documents
  for each row execute function public.documents_queue_storage_cleanup();

-- ==================== 2. research shares only reach people who can read them ====================

create or replace function public.can_receive_research_share(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_profile_id
      and p.is_active
      and p.role <> 'clerk'
      and (
        p.role <> 'magistrate'
        or exists (
          select 1 from public.magistrate_courts mc
          where mc.profile_id = p.id and mc.ended_at is null
        )
      )
  );
$$;

comment on function public.can_receive_research_share(uuid) is
  'Whether a profile can read a Judgment or personal Case Law through a share: active, not a clerk, and a magistrate only while they sit a court. The recipient half of can_view_judgment / can_view_case_law (0093, 0117), evaluated for someone other than the caller (0165). Internal: used by the share resolver, shares_recipient_guard() and judgments_notify_final().';

revoke all on function public.can_receive_research_share(uuid) from public, anon, authenticated;

create or replace function public.resolve_item_share_recipient(
  p_item_type text,
  p_item_id uuid,
  p_email text
)
returns table (
  profile_id uuid,
  display_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id as profile_id,
    p.full_name as display_name
  from public.profiles p
  where (select public.has_item_share_authority(p_item_type, p_item_id))
    and p.is_active
    and p.id is distinct from (select auth.uid())
    and lower(p.email) = lower(btrim(p_email))
    and (p_item_type = 'docket_matter' or public.can_receive_research_share(p.id))
  limit 1;
$$;

revoke all on function public.resolve_item_share_recipient(text, uuid, text) from public;
revoke all on function public.resolve_item_share_recipient(text, uuid, text) from anon;
grant execute on function public.resolve_item_share_recipient(text, uuid, text) to authenticated;

comment on function public.resolve_item_share_recipient(text, uuid, text) is
  'Exact email recipient lookup for creating a Share on docket_matter, judgment, or personal case_law. Same collapse-to-empty failure modes as resolve_docket_share_recipient (0051). 0165: for judgment and case_law, also empty unless can_receive_research_share() (never a clerk, never a magistrate without a court).';

create or replace function public.shares_recipient_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.item_type in ('judgment', 'case_law')
    and new.recipient_id is not null
    and not public.can_receive_research_share(new.recipient_id)
  then
    raise exception 'Judgments and research can be shared only with a magistrate who sits a court, or an administrator. Clerks cannot open them.';
  end if;

  return new;
end;
$$;

comment on function public.shares_recipient_guard() is
  'BEFORE INSERT on shares (0165): a Judgment or personal Case Law share must go to someone can_receive_research_share() accepts. SECURITY DEFINER because the recipient''s role and court are not readable by the granting user.';

revoke all on function public.shares_recipient_guard() from public, anon, authenticated;

create trigger shares_recipient_guard_trigger
  before insert on public.shares
  for each row execute function public.shares_recipient_guard();

create or replace function public.judgments_notify_final()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  if old.status is not distinct from new.status or new.status is distinct from 'final' then
    return new;
  end if;

  for r in
    select recipient_id
    from public.shares
    where item_type = 'judgment'
      and item_id = new.id
      and revoked_at is null
      and recipient_id is not null
      and public.can_receive_research_share(recipient_id)
  loop
    perform public.notify_user(
      r.recipient_id,
      'judgment_final',
      'A judgment was finalised',
      coalesce(new.title, 'A shared judgment is now final.'),
      '/judgments/' || new.id::text
    );
  end loop;

  return new;
end;
$$;

-- ==================== 3. every share change is announced ====================

create or replace function public.notify_user(
  p_user_id uuid,
  p_type text,
  p_title text,
  p_body text default null,
  p_link text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_user_id is null or p_type is null or p_title is null then
    return null;
  end if;

  -- A share notice records a change of access, and revoke-then-share is
  -- how a share's level changes, so those are never collapsed.
  if p_type not in ('share_granted', 'share_revoked') and exists (
    select 1
    from public.notifications n
    where n.user_id = p_user_id
      and n.type = p_type
      and coalesce(n.link, '') = coalesce(p_link, '')
      and n.created_at > now() - interval '20 hours'
  ) then
    return null;
  end if;

  insert into public.notifications (user_id, type, title, body, link)
  values (p_user_id, p_type, p_title, p_body, p_link)
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.notify_user(uuid, text, text, text, text) is
  'Insert an in-app notification for one user. Dedupes identical type+link rows within 20 hours, except share_granted / share_revoked, which are always delivered (0165). No email.';

revoke all on function public.notify_user(uuid, text, text, text, text) from public, anon, authenticated;

-- ==================== 4. the server stamps the revoke time ====================

create or replace function public.shares_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_recipient_nulled boolean;
  v_granted_by_nulled boolean;
begin
  if tg_op = 'INSERT' then
    new.granted_by := (select auth.uid());
    return new;
  end if;

  v_recipient_nulled := old.recipient_id is not null and new.recipient_id is null;
  v_granted_by_nulled := old.granted_by is not null and new.granted_by is null;

  if v_recipient_nulled or v_granted_by_nulled then
    if new.item_type is distinct from old.item_type
       or new.item_id is distinct from old.item_id
       or new.permission is distinct from old.permission
       or new.created_at is distinct from old.created_at
       or (new.recipient_id is distinct from old.recipient_id and not v_recipient_nulled)
       or (new.granted_by is distinct from old.granted_by and not v_granted_by_nulled) then
      raise exception 'Unexpected combined change alongside a recipient/granter removal on a Share';
    end if;

    if v_recipient_nulled and old.revoked_at is null then
      new.revoked_at := now();
    end if;

    return new;
  end if;

  if old.revoked_at is not null then
    raise exception 'Cannot modify an already-revoked Share';
  end if;

  if new.item_type is distinct from old.item_type
     or new.item_id is distinct from old.item_id
     or new.recipient_id is distinct from old.recipient_id
     or new.granted_by is distinct from old.granted_by
     or new.permission is distinct from old.permission
     or new.created_at is distinct from old.created_at then
    raise exception 'A Share may only have revoked_at set to revoke it; no other field may change';
  end if;

  if new.revoked_at is null then
    raise exception 'Reactivating a revoked Share is not permitted; create a new Share instead, subject to the ordinary creation authorization at that time';
  end if;

  -- Any non-null revoked_at means "revoke now": the device clock is
  -- never stored (0165).
  new.revoked_at := now();

  return new;
end;
$$;

comment on function public.shares_guard() is 'Forces granted_by at INSERT. On UPDATE: permits ONLY setting revoked_at (once, never cleared) via the ordinary client path, and separately permits the recipient_id/granted_by FK''s own ON DELETE SET NULL action -- auto-revoking a still-active share ONLY when recipient_id is the column being nulled, never merely because granted_by is nulled. 0165: a revoke is always stamped with the server''s now(); the value the client sends only signals the revoke.';

-- ==================== 6. a bench note may only point at a parent its author can see ====================

create or replace function public.bench_notes_entity_guard()
returns trigger
security definer
set search_path = public
language plpgsql
as $$
declare
  v_visible boolean;
  v_reference_changed boolean;
  v_statute_id uuid;
begin
  new.author_id := auth.uid();

  v_reference_changed := (tg_op = 'INSERT')
    or (new.entity_type is distinct from old.entity_type)
    or (new.entity_id is distinct from old.entity_id);

  if v_reference_changed then
    if new.entity_type = 'docket_matter' then
      v_visible := public.can_view_docket_matter(new.entity_id);
    elsif new.entity_type = 'judgment' then
      v_visible := public.can_view_judgment(new.entity_id);
    elsif new.entity_type = 'case_law' then
      v_visible := public.can_view_case_law(new.entity_id);
    elsif new.entity_type in ('statute', 'statute_provision') then
      if new.entity_type = 'statute' then
        v_statute_id := new.entity_id;
      else
        select sp.statute_id into v_statute_id
        from public.statute_provisions sp
        where sp.id = new.entity_id;
      end if;
      -- The published Act (can_view_statute), or the author's own draft,
      -- matching "Magistrates can view own draft statutes" (0157).
      v_visible := v_statute_id is not null and (
        public.can_view_statute(v_statute_id)
        or exists (
          select 1 from public.statutes s
          where s.id = v_statute_id
            and s.review_status = 'draft'
            and s.created_by = auth.uid()
            and public.is_magistrate()
            and public.has_active_magistrate_court()
        )
      );
    else
      v_visible := false;
    end if;

    -- A parent the author cannot see gets the same error as a missing one.
    if not coalesce(v_visible, false) then
      raise exception 'bench_notes.entity_id does not reference an existing % row', new.entity_type;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.bench_notes_entity_guard() is
  'BEFORE INSERT OR UPDATE on bench_notes. Forces author_id to the caller. On INSERT, or when entity_type/entity_id changes, the parent must be one the author can see (0165: can_view_docket_matter / can_view_judgment / can_view_case_law / can_view_statute, or the author''s own draft Act); an invisible parent gets the same "does not reference an existing row" error as a missing one, so the guard is not an existence oracle. An ordinary edit never re-checks (0039), so a note survives losing access to, or deletion of, its parent. SECURITY DEFINER for the author_id stamp and the provision-to-Act lookup; the can_view_* helpers judge the caller.';
