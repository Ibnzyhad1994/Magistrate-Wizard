-- ============================================================================
-- 0160_anon_and_auth_surface.sql
--
-- Forward-only hardening of the anonymous and sign-up surface, from the
-- 2026-10-15 agentic audit (theme T4: A-04, A-01, A-02, A-03, and the anon
-- part of C-12). Every change narrows an existing envelope; no invariant in
-- docs/adr/ is reopened.
--
-- 1. A-04: the anon key (shipped in every browser bundle) could read
--    discoverable Judgments in full, canonical / discoverable Case Law with
--    full_text, and published Statutes and their provisions. The SELECT
--    policies were granted TO public and their "discoverable" / "canonical"
--    / "published" branches never asked for a signed-in caller; for anon,
--    is_clerk() and is_magistrate() are false, so the leading guards
--    passed. ADR 0002 scopes "discoverable" to the signed-in magistrate
--    community, and ADR 0003 makes canonical Case Law readable by every
--    authorised user, not by the internet.
--    a. can_view_judgment / can_view_case_law / can_view_statute (0121,
--       0055) also return false for a caller with no auth.uid(). They gate
--       judgment_tags, statute_provisions, documents and storage objects
--       through policies that stay TO public, so this closes the same hole
--       for attached files and tags. They keep anon EXECUTE (see 0133:
--       a policy-evaluated helper without it fails the whole query).
--    b. The Judgments, Case Law, Statutes and Statute Provisions SELECT
--       policies, Judgment Tags, and the six reference tables whose
--       policies are already named "viewable by all authenticated users"
--       (USING true) are re-scoped TO authenticated, matching courts, tags
--       and feature_flags. The sign-up page reads none of them; it uses
--       the list_active_*_for_signup RPCs.
-- 2. A-01: handle_new_user (0152) copied raw_user_meta_data ->> 'court_id'
--    into profiles.court_id with no validation and no approval, and
--    my_court_id() then granted read and write on that court's legacy
--    `cases` family and its documents. The app never sends that key.
--    a. handle_new_user no longer reads it; a new profile starts with no
--       court. Requested courts still become pending requests, as before.
--    b. my_court_id() returns profiles.court_id only while the caller holds
--       an active, approved magistrate_courts or clerk_courts assignment at
--       that court, so the column alone grants nothing. Profiles already
--       carrying an unapproved court_id lose that access without any data
--       being rewritten.
-- 3. A-03 / A-02: submit_clerk_access_request (0088) now mirrors its
--    magistrate twin (submit_magistrate_court_request): the court must
--    exist and be active, an existing active assignment or pending request
--    is refused in plain English, and a double submit that races past the
--    pre-check gets the same sentence instead of a raw 23505 from
--    clerk_access_requests_pending_pair_idx. EXECUTE is revoked from
--    public/anon like the other clerk RPCs in 0149.
-- 4. C-12 (anon part): search_quick_codes (0047) and search_cases (0010)
--    were missed by 0138. Revoke public/anon; authenticated keeps EXECUTE.
-- ============================================================================

-- ==================== 1a. visibility helpers need a signed-in caller ====================

create or replace function public.can_view_judgment(p_judgment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.judgments j
    where j.id = p_judgment_id
      and (select auth.uid()) is not null
      and not (select public.is_clerk())
      and (not (select public.is_magistrate()) or (select public.has_active_magistrate_court()))
      and (
        j.owner_id = (select auth.uid())
        or j.is_discoverable = true
        or public.has_item_share('judgment', p_judgment_id, 'view')
      )
  );
$$;

create or replace function public.can_view_case_law(p_case_law_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.case_law cl
    where cl.id = p_case_law_id
      and (select auth.uid()) is not null
      and not (select public.is_clerk())
      and (not (select public.is_magistrate()) or (select public.has_active_magistrate_court()))
      and (
        cl.owner_id is null
        or cl.owner_id = (select auth.uid())
        or cl.is_discoverable = true
        or public.has_item_share('case_law', p_case_law_id, 'view')
      )
  );
$$;

create or replace function public.can_view_statute(p_statute_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.statutes s
    where s.id = p_statute_id
      and (select auth.uid()) is not null
      and not (select public.is_clerk())
      and (not (select public.is_magistrate()) or (select public.has_active_magistrate_court()))
      and (s.review_status = 'published' or public.is_admin())
  );
$$;

-- ==================== 1b. library and reference reads: authenticated only ====================

alter policy "Owners and discoverable readers can view Judgments"
  on public.judgments to authenticated;
alter policy "Owners and discoverable readers can view Judgment Tags"
  on public.judgment_tags to authenticated;
alter policy "Canonical, own, and discoverable Case Law is viewable"
  on public.case_law to authenticated;
alter policy "Published statutes are viewable by all authenticated users; adm"
  on public.statutes to authenticated;
alter policy "Magistrates can view own draft statutes"
  on public.statutes to authenticated;
alter policy "Provisions are viewable when the parent statute is"
  on public.statute_provisions to authenticated;

alter policy "Court non-sitting days are viewable by all authenticated users"
  on public.court_non_sitting_days to authenticated;
alter policy "Docket matter categories are viewable by all authenticated user"
  on public.docket_matter_categories to authenticated;
alter policy "Authority courts are viewable by all authenticated users"
  on public.legal_authority_courts to authenticated;
alter policy "Case categories are viewable by all authenticated users"
  on public.legal_case_categories to authenticated;
alter policy "Jurisdictions are viewable by all authenticated users"
  on public.legal_jurisdictions to authenticated;
alter policy "Regional groups are viewable by all authenticated users"
  on public.legal_regional_groups to authenticated;

-- ==================== 2a. sign-up ignores a client-supplied court_id ====================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role;
  v_requested_court_ids uuid[];
begin
  v_role := case
    when new.raw_user_meta_data ->> 'requested_role' = 'clerk' then 'clerk'::public.user_role
    else 'magistrate'::public.user_role
  end;

  -- profiles.court_id is never taken from sign-up metadata (0160): court
  -- access comes only from an approved magistrate_courts / clerk_courts row.
  insert into public.profiles (id, email, full_name, avatar_url, role)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url',
    v_role
  );

  begin
    select array_agg(elem::uuid)
    into v_requested_court_ids
    from jsonb_array_elements_text(
      coalesce(new.raw_user_meta_data -> 'requested_court_ids', '[]'::jsonb)
    ) as elem;
  exception when others then
    v_requested_court_ids := null;
  end;

  if v_requested_court_ids is not null and array_length(v_requested_court_ids, 1) > 0 then
    if v_role = 'clerk' then
      insert into public.clerk_access_requests (profile_id, court_id, staff_id, note)
      select
        new.id,
        c.id,
        nullif(trim(new.raw_user_meta_data ->> 'staff_id'), ''),
        nullif(trim(new.raw_user_meta_data ->> 'note'), '')
      from public.courts c
      where c.id = any (v_requested_court_ids) and c.is_active = true
      on conflict (profile_id, court_id) where status = 'pending' do nothing;
    elsif v_role = 'magistrate' then
      insert into public.magistrate_court_requests (profile_id, court_id, staff_id, note, request_kind)
      select
        new.id,
        c.id,
        nullif(trim(new.raw_user_meta_data ->> 'staff_id'), ''),
        nullif(trim(new.raw_user_meta_data ->> 'note'), ''),
        case
          when public.court_has_active_primary_magistrate(c.id) then 'occupied_exception'
          else 'ordinary'
        end
      from public.courts c
      where c.id = any (v_requested_court_ids) and c.is_active = true
      on conflict (profile_id, court_id) where status = 'pending' do nothing;
    end if;
  end if;

  return new;
end;
$$;

-- ==================== 2b. my_court_id() needs an approved assignment ====================

create or replace function public.my_court_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.court_id
  from public.profiles p
  where p.id = (select auth.uid())
    and (
      exists (
        select 1 from public.magistrate_courts mc
        where mc.profile_id = p.id and mc.court_id = p.court_id and mc.ended_at is null
      )
      or exists (
        select 1 from public.clerk_courts cc
        where cc.profile_id = p.id and cc.court_id = p.court_id and cc.ended_at is null
      )
    );
$$;

comment on function public.my_court_id() is
  'The caller''s legacy profiles.court_id, but only while they hold an active, approved magistrate_courts or clerk_courts assignment at that court (0160). Gates the legacy cases family and its documents; the column alone grants nothing.';

-- ==================== 3. clerk access requests validate like the magistrate twin ====================

create or replace function public.submit_clerk_access_request(
  p_court_id uuid,
  p_staff_id text default null,
  p_note text default null
)
returns public.clerk_access_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result public.clerk_access_requests;
begin
  if not (select public.is_clerk()) then
    raise exception 'Only a clerk account may submit a court access request';
  end if;

  if not exists (select 1 from public.courts where id = p_court_id and is_active = true) then
    raise exception 'Court not found or inactive';
  end if;

  if exists (
    select 1 from public.clerk_courts
    where profile_id = (select auth.uid()) and court_id = p_court_id and ended_at is null
  ) then
    raise exception 'You already have access to this court';
  end if;

  if exists (
    select 1 from public.clerk_access_requests
    where profile_id = (select auth.uid()) and court_id = p_court_id and status = 'pending'
  ) then
    raise exception 'You already have a pending request for this court';
  end if;

  begin
    insert into public.clerk_access_requests (profile_id, court_id, staff_id, note)
    values ((select auth.uid()), p_court_id, nullif(trim(p_staff_id), ''), nullif(trim(p_note), ''))
    returning * into v_result;
  exception when unique_violation then
    -- A concurrent double submit passed the pre-check above; the partial
    -- unique index clerk_access_requests_pending_pair_idx caught it.
    raise exception 'You already have a pending request for this court';
  end;

  return v_result;
end;
$$;

revoke all on function public.submit_clerk_access_request(uuid, text, text) from public, anon;
grant execute on function public.submit_clerk_access_request(uuid, text, text) to authenticated;

-- ==================== 4. search RPCs missed by 0138 ====================

revoke all on function public.search_quick_codes(text, integer) from public, anon;
revoke all on function public.search_cases(text, integer) from public, anon;
grant execute on function public.search_quick_codes(text, integer) to authenticated;
grant execute on function public.search_cases(text, integer) to authenticated;
