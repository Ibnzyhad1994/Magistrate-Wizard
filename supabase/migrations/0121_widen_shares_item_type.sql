-- 0121_widen_shares_item_type.sql
--
-- Widen public.shares beyond Docket Matters so a magistrate can grant
-- view/edit on a Judgment they own, or on personal Case Law they own
-- (owner_id IS NOT NULL). Canonical Case Law (owner_id IS NULL) stays
-- globally readable and cannot be shared.
--
-- 0037 stored item_id as a genuine FK to docket_matters because
-- item_type was single-valued. That FK cannot survive a polymorphic
-- item_id; it is dropped and replaced with a BEFORE INSERT existence
-- trigger. Docket Matter DELETE still RESTRICTS if any Share rows
-- remain (same practical rule as the old FK). Judgment / personal Case
-- Law DELETE removes the Share rows so a lawful draft delete is not
-- blocked.
--
-- Table-level SELECT/UPDATE on judgments and case_law is INLINE (0050 /
-- 0118), not routed through can_view_*(). Helpers are still updated
-- because documents, tags, and search RPCs consume them. Both layers
-- must mention has_item_share() or recipients would 401 on PostgREST
-- even when the helper returned true.
--
-- Recursion: has_item_share() is SECURITY DEFINER and only reads
-- shares filtered by recipient_id = auth.uid(). It never calls
-- can_view_judgment / can_view_case_law. Share-management policies use
-- has_item_share_authority(), which reads parent tables as DEFINER and
-- never consults shares — same split as has_docket_matter_authority().

-- 1. Drop the live item_type CHECK (name is not assumed) ----------------

do $$
declare
  cname text;
begin
  select con.conname
    into cname
  from pg_constraint con
  where con.conrelid = 'public.shares'::regclass
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%item_type%'
    and pg_get_constraintdef(con.oid) ilike '%docket_matter%'
    and pg_get_constraintdef(con.oid) not ilike '%judgment%';
  if cname is not null then
    execute format('alter table public.shares drop constraint %I', cname);
  end if;
end $$;

alter table public.shares
  add constraint shares_item_type_check
  check (item_type in ('docket_matter', 'judgment', 'case_law'));

-- 2. Drop the docket_matters FK (name looked up, not assumed) -----------

do $$
declare
  cname text;
begin
  select con.conname
    into cname
  from pg_constraint con
  where con.conrelid = 'public.shares'::regclass
    and con.contype = 'f'
    and con.confrelid = 'public.docket_matters'::regclass;
  if cname is not null then
    execute format('alter table public.shares drop constraint %I', cname);
  end if;
end $$;

-- 3. Polymorphic existence + canonical Case Law rejection ---------------

create or replace function public.shares_item_must_exist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.item_type = 'docket_matter' then
    if not exists (select 1 from public.docket_matters where id = new.item_id) then
      raise exception 'Share item_id must reference an existing Docket Matter';
    end if;
  elsif new.item_type = 'judgment' then
    if not exists (select 1 from public.judgments where id = new.item_id) then
      raise exception 'Share item_id must reference an existing Judgment';
    end if;
  elsif new.item_type = 'case_law' then
    if not exists (
      select 1 from public.case_law
      where id = new.item_id and owner_id is not null
    ) then
      raise exception 'Share item_id must reference existing personal Case Law; canonical Case Law cannot be shared';
    end if;
  else
    raise exception 'Unsupported share item_type';
  end if;
  return new;
end;
$$;

create trigger shares_item_must_exist_trigger
  before insert on public.shares
  for each row execute function public.shares_item_must_exist();

create or replace function public.shares_prevent_docket_parent_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.shares s
    where s.item_type = 'docket_matter' and s.item_id = old.id
  ) then
    raise exception 'Cannot delete a Docket Matter while Shares still reference it';
  end if;
  return old;
end;
$$;

create trigger shares_prevent_docket_parent_delete_trigger
  before delete on public.docket_matters
  for each row execute function public.shares_prevent_docket_parent_delete();

create or replace function public.shares_delete_for_parent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.shares
  where item_type = tg_argv[0]
    and item_id = old.id;
  return old;
end;
$$;

create trigger shares_delete_for_judgment_trigger
  before delete on public.judgments
  for each row execute function public.shares_delete_for_parent('judgment');

create trigger shares_delete_for_case_law_trigger
  before delete on public.case_law
  for each row execute function public.shares_delete_for_parent('case_law');

comment on column public.shares.item_type is
  'docket_matter, judgment, or case_law. Canonical Case Law (owner_id IS NULL) is rejected by shares_item_must_exist().';
comment on column public.shares.item_id is
  'Polymorphic id of the shared row. Existence is enforced by shares_item_must_exist(); there is no single-table FK.';

-- 4. Helpers ------------------------------------------------------------

create or replace function public.has_item_share(
  p_item_type text,
  p_item_id uuid,
  p_required_permission text default 'view'
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.shares s
    where s.item_type = p_item_type
      and s.item_id = p_item_id
      and s.recipient_id = (select auth.uid())
      and s.revoked_at is null
      and (p_required_permission = 'view' or s.permission = 'edit')
  );
$$;

comment on function public.has_item_share(text, uuid, text) is
  'True if the caller holds an active share on (item_type, item_id) at or above p_required_permission. edit implies view. SECURITY DEFINER so can_view_* / inline table policies can call it without RLS recursion through shares.';

create or replace function public.has_item_share_authority(
  p_item_type text,
  p_item_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case p_item_type
    when 'docket_matter' then public.has_docket_matter_authority(p_item_id)
    when 'judgment' then exists (
      select 1 from public.judgments j
      where j.id = p_item_id and j.owner_id = (select auth.uid())
    )
    when 'case_law' then exists (
      select 1 from public.case_law cl
      where cl.id = p_item_id and cl.owner_id = (select auth.uid())
    )
    else false
  end;
$$;

comment on function public.has_item_share_authority(text, uuid) is
  'Share-management authority (create/revoke/see): Docket Court/retained path, Judgment owner, or personal Case Law owner. Canonical Case Law (owner_id IS NULL) is never true. Does not consult shares — no resharing. SECURITY DEFINER so shares RLS can call it without recursion.';

-- 5. can_view / can_edit helpers (documents, tags, search) --------------

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
      and not (select public.is_clerk())
      and (not (select public.is_magistrate()) or (select public.has_active_magistrate_court()))
      and (
        j.owner_id = (select auth.uid())
        or j.is_discoverable = true
        or public.has_item_share('judgment', p_judgment_id, 'view')
      )
  );
$$;

comment on function public.can_view_judgment(uuid) is
  'Judgment read envelope: owner OR discoverable OR active share — EXCEPT a clerk (0093) or a magistrate with no currently-active Court (0117).';

create or replace function public.can_edit_judgment(p_judgment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.judgments j
    where j.id = p_judgment_id
      and not (select public.is_clerk())
      and (
        j.owner_id = (select auth.uid())
        or public.has_item_share('judgment', p_judgment_id, 'edit')
      )
  );
$$;

comment on function public.can_edit_judgment(uuid) is
  'Judgment edit envelope: owner OR active edit share. Clerks denied. Lifecycle locking (0045) remains a separate trigger, not folded in here.';

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

comment on function public.can_view_case_law(uuid) is
  'Case Law read envelope: canonical OR personal owner OR discoverable OR active share — EXCEPT a clerk (0093) or a magistrate with no currently-active Court (0117).';

create or replace function public.can_edit_case_law(p_case_law_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.case_law cl
    where cl.id = p_case_law_id
      and not (select public.is_clerk())
      and (
        (cl.owner_id is null and public.is_admin())
        or cl.owner_id = (select auth.uid())
        or public.has_item_share('case_law', p_case_law_id, 'edit')
      )
  );
$$;

comment on function public.can_edit_case_law(uuid) is
  'Case Law edit envelope: admin on canonical, owner on personal, or active edit share on personal. Clerks denied. Admin still cannot edit another user''s personal row merely by being admin.';

-- 6. shares table policies ----------------------------------------------

drop policy "Share visibility for management" on public.shares;
create policy "Share visibility for management"
  on public.shares for select
  using (
    granted_by = (select auth.uid())
    or recipient_id = (select auth.uid())
    or (select public.has_item_share_authority(item_type, item_id))
  );

drop policy "Current Docket-access holders can create Shares" on public.shares;
create policy "Current Docket-access holders can create Shares"
  on public.shares for insert
  with check (
    (select public.has_item_share_authority(item_type, item_id))
    and granted_by = (select auth.uid())
    and recipient_id is not null
    and recipient_id is distinct from (select auth.uid())
  );

drop policy "Current Docket-access holders and recipients can revoke Shares" on public.shares;
create policy "Current Docket-access holders and recipients can revoke Shares"
  on public.shares for update
  using (
    (select public.has_item_share_authority(item_type, item_id))
    or recipient_id = (select auth.uid())
  )
  with check (
    (select public.has_item_share_authority(item_type, item_id))
    or recipient_id = (select auth.uid())
  );

-- 7. Inline table policies (0118) — share recipients must pass these ----

alter policy "Owners and discoverable readers can view Judgments"
  on public.judgments
  using (
    not (select public.is_clerk())
    and (not (select public.is_magistrate()) or (select public.has_active_magistrate_court()))
    and (
      owner_id = (select auth.uid())
      or is_discoverable = true
      or public.has_item_share('judgment', id, 'view')
    )
  );

alter policy "Owners can update Judgments"
  on public.judgments
  using (
    not (select public.is_clerk())
    and (not (select public.is_magistrate()) or (select public.has_active_magistrate_court()))
    and (
      owner_id = (select auth.uid())
      or public.has_item_share('judgment', id, 'edit')
    )
  )
  with check (
    not (select public.is_clerk())
    and (not (select public.is_magistrate()) or (select public.has_active_magistrate_court()))
    and (
      owner_id = (select auth.uid())
      or public.has_item_share('judgment', id, 'edit')
    )
  );

alter policy "Canonical, own, and discoverable Case Law is viewable"
  on public.case_law
  using (
    not (select public.is_clerk())
    and (not (select public.is_magistrate()) or (select public.has_active_magistrate_court()))
    and (
      owner_id is null
      or owner_id = (select auth.uid())
      or is_discoverable = true
      or public.has_item_share('case_law', id, 'view')
    )
  );

alter policy "Admins update canonical Case Law; owners update their personal "
  on public.case_law
  using (
    not (select public.is_clerk())
    and (not (select public.is_magistrate()) or (select public.has_active_magistrate_court()))
    and (
      (owner_id is null and (select public.is_admin()))
      or owner_id = (select auth.uid())
      or public.has_item_share('case_law', id, 'edit')
    )
  )
  with check (
    not (select public.is_clerk())
    and (not (select public.is_magistrate()) or (select public.has_active_magistrate_court()))
    and (
      (owner_id is null and (select public.is_admin()))
      or owner_id = (select auth.uid())
      or public.has_item_share('case_law', id, 'edit')
    )
  );

-- 8. Identity + recipient lookup ----------------------------------------

create or replace function public.resolve_docket_share_identity(p_share_id uuid)
returns table (
  recipient_id uuid,
  recipient_display_name text,
  granted_by uuid,
  grantor_display_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.recipient_id,
    pr.full_name as recipient_display_name,
    s.granted_by,
    pg2.full_name as grantor_display_name
  from public.shares s
  left join public.profiles pr on pr.id = s.recipient_id
  left join public.profiles pg2 on pg2.id = s.granted_by
  where s.id = p_share_id
    and (
      s.granted_by = (select auth.uid())
      or s.recipient_id = (select auth.uid())
      or (select public.has_item_share_authority(s.item_type, s.item_id))
    );
$$;

comment on function public.resolve_docket_share_identity(uuid) is
  'Identity lookup for one shares row (any item_type). Gated by grantor, recipient, or has_item_share_authority().';

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
  limit 1;
$$;

revoke all on function public.resolve_item_share_recipient(text, uuid, text) from public;
revoke all on function public.resolve_item_share_recipient(text, uuid, text) from anon;
grant execute on function public.resolve_item_share_recipient(text, uuid, text) to authenticated;

comment on function public.resolve_item_share_recipient(text, uuid, text) is
  'Exact email recipient lookup for creating a Share on docket_matter, judgment, or personal case_law. Same collapse-to-empty failure modes as resolve_docket_share_recipient (0051).';

grant execute on function public.has_item_share(text, uuid, text) to authenticated;
grant execute on function public.has_item_share_authority(text, uuid) to authenticated;
revoke all on function public.has_item_share(text, uuid, text) from anon;
revoke all on function public.has_item_share_authority(text, uuid) from anon;
