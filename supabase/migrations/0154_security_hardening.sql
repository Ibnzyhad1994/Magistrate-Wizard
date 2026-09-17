-- ============================================================================
-- 0154_security_hardening.sql
--
-- Forward-only hardening migration from the 2026-09-17 system audit (§3).
-- Nothing here reopens an established invariant (owner-only Quick Codes,
-- no admin bypass on Judgments, three-path docket predicate, view/edit
-- share split); every change narrows an existing envelope.
--
-- 1. profiles self-update pins court_id / is_active / email as well as
--    role. Threat: my_court_id() (0002) reads profiles.court_id and the
--    legacy `cases` rows and their documents gate on it (0012, 0134), so a
--    self-editable court_id let any signed-in user read another Court's
--    cases. Same for is_active (self-reactivation) and email (identity
--    drift from auth.users). Three new SECURITY DEFINER readers follow
--    0132's current_profile_role() pattern so the WITH CHECK does not
--    recurse into profiles' own RLS. They read ONLY the caller's own row
--    (auth.uid()), expose nothing about anyone else, pin search_path, and
--    are EXECUTE-granted to authenticated only. The client never updates
--    these columns; all court assignment goes through DEFINER RPCs.
-- 2. audit_profiles_privilege (0113) also fires on court_id changes, and
--    the slim profiles payload now carries court_id so the row is useful.
-- 3. Judgment lifecycle: only the owner may finalise / unlock / toggle
--    is_discoverable. can_edit_judgment (0121) accepts an active EDIT
--    share for content edits -- that stays -- but lifecycle and
--    discoverability are ownership decisions. The DELETE policy likewise
--    becomes owner-only (still draft-only, per 0045). auth.uid() IS NULL
--    (service role / cron, which bypasses RLS anyway) is left alone so
--    existing service-side maintenance is unaffected. No admin bypass.
-- 4. EXECUTE revoked from public/anon on six RPCs that were never
--    revoked (all fail closed, but anon could invoke them and read the
--    error text). authenticated keeps EXECUTE.
-- 5. audit_log_assign_hash (0126) takes a transaction advisory lock
--    before reading the chain head so concurrent inserts cannot fork it.
-- 6. enforce_rpc_rate_limit (0137) only accepts the fixed set of bucket
--    names its INVOKER wrappers use, and sweeps buckets older than a day
--    for every user/name so the table cannot bloat.
-- 7. case_law.source_url / statutes.source_url must be http(s) (NOT
--    VALID so existing rows do not block the apply; the UI also gates on
--    isSafeHref).
-- ============================================================================

-- ==================== 1. profiles self-update pins ====================

create or replace function public.current_profile_court_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select court_id from public.profiles where id = auth.uid();
$$;

comment on function public.current_profile_court_id() is
  'The caller''s own current court_id, read via SECURITY DEFINER so the profiles self-update WITH CHECK (0154) can pin it without recursing into profiles RLS. Same pattern and threat model as current_profile_role() (0132): own row only, pinned search_path, authenticated only.';

create or replace function public.current_profile_is_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select is_active from public.profiles where id = auth.uid();
$$;

comment on function public.current_profile_is_active() is
  'The caller''s own current is_active flag (0154). See current_profile_court_id().';

create or replace function public.current_profile_email()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select email from public.profiles where id = auth.uid();
$$;

comment on function public.current_profile_email() is
  'The caller''s own current profiles.email (0154). See current_profile_court_id().';

revoke all on function public.current_profile_court_id() from public, anon;
revoke all on function public.current_profile_is_active() from public, anon;
revoke all on function public.current_profile_email() from public, anon;
grant execute on function public.current_profile_court_id() to authenticated;
grant execute on function public.current_profile_is_active() to authenticated;
grant execute on function public.current_profile_email() to authenticated;

alter policy "Profiles are editable by owner or admin"
  on public.profiles
  with check (
    (
      (select auth.uid()) = id
      and role = (select public.current_profile_role())
      and court_id is not distinct from (select public.current_profile_court_id())
      and is_active is not distinct from (select public.current_profile_is_active())
      and email is not distinct from (select public.current_profile_email())
    )
    or (select public.is_admin())
  );

-- ==================== 2. profiles privilege audit includes court_id ====================
-- audit_trigger_fn() re-declared from its latest definition (0113) with
-- court_id added to the slim profiles payload. Every other branch is
-- byte-for-byte the 0113 body.

create or replace function public.audit_trigger_fn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
begin
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
  elsif tg_op = 'DELETE' then
    v_old := to_jsonb(old);
  end if;

  if tg_table_name = 'judgments' then
    v_old := v_old - 'content' - 'content_text' - 'search_vector';
    v_new := v_new - 'content' - 'content_text' - 'search_vector';
  elsif tg_table_name = 'bench_notes' then
    v_old := v_old - 'content' - 'content_text' - 'search_vector';
    v_new := v_new - 'content' - 'content_text' - 'search_vector';
  elsif tg_table_name = 'quick_codes' then
    v_old := v_old - 'content' - 'description' - 'search_vector';
    v_new := v_new - 'content' - 'description' - 'search_vector';
  elsif tg_table_name = 'case_law_annotations' then
    v_old := v_old - 'annotation_text';
    v_new := v_new - 'annotation_text';
  elsif tg_table_name = 'docket_matter_parties' then
    v_old := v_old - 'contact_info';
    v_new := v_new - 'contact_info';
  elsif tg_table_name = 'case_law' then
    if (tg_op = 'DELETE' and old.owner_id is not null)
       or (tg_op in ('INSERT', 'UPDATE') and new.owner_id is not null) then
      v_old := v_old - 'summary' - 'full_text' - 'search_vector';
      v_new := v_new - 'summary' - 'full_text' - 'search_vector';
    end if;
  end if;

  -- Privilege-only capture for profiles. The UPDATE trigger's WHEN
  -- clause already skips name/avatar noise; this slim object is what
  -- actually lands in audit_log so avatar_url never does.
  if tg_table_name = 'profiles' then
    if tg_op = 'DELETE' then
      v_old := jsonb_build_object(
        'id', old.id,
        'role', old.role,
        'is_active', old.is_active,
        'court_id', old.court_id,
        'email', old.email,
        'full_name', old.full_name
      );
    else
      if tg_op = 'UPDATE' then
        v_old := jsonb_build_object(
          'id', old.id,
          'role', old.role,
          'is_active', old.is_active,
          'court_id', old.court_id,
          'email', old.email,
          'full_name', old.full_name
        );
      end if;
      v_new := jsonb_build_object(
        'id', new.id,
        'role', new.role,
        'is_active', new.is_active,
        'court_id', new.court_id,
        'email', new.email,
        'full_name', new.full_name
      );
    end if;
  end if;

  if tg_op = 'INSERT' then
    insert into public.audit_log (actor_id, action, table_name, record_id, new_data)
    values (auth.uid(), 'insert', tg_table_name, new.id, v_new);
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.audit_log (actor_id, action, table_name, record_id, old_data, new_data)
    values (auth.uid(), 'update', tg_table_name, new.id, v_old, v_new);
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.audit_log (actor_id, action, table_name, record_id, old_data)
    values (auth.uid(), 'delete', tg_table_name, old.id, v_old);
    return old;
  end if;
  return null;
end;
$$;


comment on function public.audit_trigger_fn() is
  'Generic AFTER INSERT/UPDATE/DELETE audit trigger, SECURITY DEFINER, search_path pinned to public. 0048 redaction unchanged. 0113: profiles writes a slim privilege payload only. 0154: that payload also carries court_id.';

drop trigger if exists audit_profiles_privilege on public.profiles;
create trigger audit_profiles_privilege
  after update on public.profiles
  for each row
  when (
    old.role is distinct from new.role
    or old.is_active is distinct from new.is_active
    or old.email is distinct from new.email
    or old.court_id is distinct from new.court_id
  )
  execute function public.audit_trigger_fn();

-- ==================== 3. Judgment lifecycle is owner-only ====================
-- Latest body: 0116. Only the owner guard at the top of the UPDATE branch
-- is new; the 0045/0046 transition rules below it are unchanged.

create or replace function public.protect_judgment_lifecycle()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    new.status := 'draft';
    new.finalized_at := null;
    new.finalized_by := null;
    return new;
  end if;

  -- 0154: finalise / unlock / discoverability are ownership decisions.
  -- An active EDIT share (can_edit_judgment, 0121) may edit content but
  -- never change lifecycle state. auth.uid() IS NULL (service role /
  -- cron, which bypasses RLS anyway) is deliberately not blocked here.
  if v_actor is not null
     and old.owner_id <> v_actor
     and (
       new.status is distinct from old.status
       or new.is_discoverable is distinct from old.is_discoverable
     )
  then
    raise exception 'Only the Judgment owner may finalise, unlock, or change discoverability.';
  end if;

  if old.status = 'draft' and new.status = 'final' then
    new.finalized_at := now();
    new.finalized_by := v_actor;
    return new;
  end if;

  if old.status = 'final' then
    if new.status = 'draft' then
      if new.title is distinct from old.title
        or new.case_number is distinct from old.case_number
        or new.court_name is distinct from old.court_name
        or new.judgment_date is distinct from old.judgment_date
        or new.citation is distinct from old.citation
        or new.content is distinct from old.content
        or new.content_text is distinct from old.content_text
      then
        raise exception 'Cannot unlock (final -> draft) and edit substantive Judgment fields in the same statement. Unlock first, then edit in a separate UPDATE.';
      end if;
      new.finalized_at := old.finalized_at;
      new.finalized_by := old.finalized_by;
      return new;
    elsif new.status = 'final' then
      if new.title is distinct from old.title
        or new.case_number is distinct from old.case_number
        or new.court_name is distinct from old.court_name
        or new.judgment_date is distinct from old.judgment_date
        or new.citation is distinct from old.citation
        or new.content is distinct from old.content
        or new.content_text is distinct from old.content_text
      then
        raise exception 'Judgment is final; substantive fields (title, case_number, court_name, judgment_date, citation, content, content_text) are locked. Unlock (status -> draft) before editing.';
      end if;
      new.finalized_at := old.finalized_at;
      new.finalized_by := old.finalized_by;
      return new;
    else
      raise exception 'Invalid Judgment status transition.';
    end if;
  end if;

  new.finalized_at := old.finalized_at;
  new.finalized_by := old.finalized_by;
  return new;
end;
$$;

comment on function public.protect_judgment_lifecycle() is
  'Judgment lifecycle guard (0045/0046/0116). 0154: status and is_discoverable changes raise unless auth.uid() is the owner (an edit-share recipient may edit content only). No admin bypass; service-role context (auth.uid() null) untouched.';

drop policy if exists "Owners can delete Judgments" on public.judgments;
create policy "Owners can delete Judgments"
  on public.judgments for delete
  using (owner_id = (select auth.uid()) and status = 'draft');

-- ==================== 4. Revoke PUBLIC/anon EXECUTE ====================

revoke all on function public.return_unassigned_magistrate_to_requester(uuid, text) from public, anon;
revoke all on function public.correct_unassigned_account_type(uuid, public.user_role, text) from public, anon;
revoke all on function public.submit_magistrate_court_request(uuid, text, text) from public, anon;
revoke all on function public.can_manage_clerk_access(uuid) from public, anon;
revoke all on function public.court_has_no_clerk_approver(uuid) from public, anon;
revoke all on function public.current_profile_role() from public, anon;

grant execute on function public.return_unassigned_magistrate_to_requester(uuid, text) to authenticated;
grant execute on function public.correct_unassigned_account_type(uuid, public.user_role, text) to authenticated;
grant execute on function public.submit_magistrate_court_request(uuid, text, text) to authenticated;
grant execute on function public.can_manage_clerk_access(uuid) to authenticated;
grant execute on function public.court_has_no_clerk_approver(uuid) to authenticated;
grant execute on function public.current_profile_role() to authenticated;

-- ==================== 5. Audit hash chain serialisation ====================
-- Body otherwise identical to 0126. search_path keeps `extensions` because
-- audit_log_digest() resolves pgcrypto there.

create or replace function public.audit_log_assign_hash()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  prev text;
  digest text;
begin
  -- 0154: serialise chain-head reads. FOR UPDATE alone lets two inserts
  -- read the same predecessor when neither has hashed yet.
  perform pg_advisory_xact_lock(hashtext('audit_log_hash_chain'));

  select a.row_hash
    into prev
  from public.audit_log a
  where a.id <> new.id
    and a.row_hash is not null
  order by a.id desc
  limit 1
  for update;

  prev := coalesce(prev, 'genesis');
  digest := public.audit_log_digest(
    public.audit_log_payload(
      prev,
      new.id,
      new.action,
      new.table_name,
      new.record_id,
      new.actor_id,
      new.created_at,
      new.old_data,
      new.new_data
    )
  );

  update public.audit_log
     set prev_hash = prev,
         row_hash = digest
   where id = new.id;

  return null;
end;
$$;

-- ==================== 6. Rate limiter allowlist + sweep ====================
-- The grant to authenticated stays: the INVOKER search wrappers call this
-- as the caller. The allowlist is exactly the names those wrappers pass
-- (0137, 0145), so a direct caller cannot pick an arbitrary bucket.

create or replace function public.enforce_rpc_rate_limit(
  p_rpc text,
  p_max integer,
  p_window_seconds integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_window timestamptz;
  v_count integer;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;
  if p_rpc is null or btrim(p_rpc) = '' or p_max is null or p_window_seconds is null
     or p_max < 1 or p_window_seconds < 1 then
    raise exception 'Invalid rate limit arguments';
  end if;
  if p_rpc not in (
    'global_search',
    'search_docket_matters',
    'search_case_law',
    'search_case_law_scoped',
    'search_judgments',
    'search_statutes',
    'search_bench_notes',
    'download_my_data'
  ) then
    raise exception 'Unknown rate-limited RPC';
  end if;

  v_window := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into public.rpc_rate_limit_buckets as b (user_id, rpc_name, window_start, hit_count)
  values (uid, p_rpc, v_window, 1)
  on conflict (user_id, rpc_name, window_start)
  do update set hit_count = b.hit_count + 1
  returning hit_count into v_count;

  delete from public.rpc_rate_limit_buckets
  where user_id = uid
    and rpc_name = p_rpc
    and window_start < v_window;

  -- 0154: sweep every stale bucket, not only the caller's, so users who
  -- never search again do not leave rows behind for ever.
  delete from public.rpc_rate_limit_buckets
  where window_start < now() - interval '1 day';

  if v_count > p_max then
    raise exception 'rate_limited'
      using hint = 'Too many requests. Try again in a minute.';
  end if;
end;
$$;

comment on function public.enforce_rpc_rate_limit(text, integer, integer) is
  'Increments the caller''s window for p_rpc and raises rate_limited when hit_count exceeds p_max. 0154: p_rpc must be one of the fixed wrapper names; buckets older than one day are swept on every call.';

revoke all on function public.enforce_rpc_rate_limit(text, integer, integer) from public, anon;
grant execute on function public.enforce_rpc_rate_limit(text, integer, integer) to authenticated;

-- ==================== 7. source_url scheme ====================

alter table public.case_law
  add constraint case_law_source_url_scheme_check
  check (source_url is null or source_url ~* '^https?://') not valid;

alter table public.statutes
  add constraint statutes_source_url_scheme_check
  check (source_url is null or source_url ~* '^https?://') not valid;
