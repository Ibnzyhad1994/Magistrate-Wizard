-- ============================================================================
-- 0129_docket_callover.sql
--
-- Callover: the sitting at which many matters are called in quick
-- succession to check status and set dates, and at which matters that
-- pre-date this docket get captured at their true position.
--
-- Two problems this closes:
--
--   1. Recording an outcome and a next date meant opening every file
--      individually. A callover of thirty matters was thirty round-trips
--      through the matter detail page.
--
--   2. `procedure_stage` is `generated always as (...) stored` (0070) and
--      walks the eight status columns left-to-right, so a newly-created
--      matter ALWAYS computes to 'arraignment'. A case inherited from a
--      predecessor that is genuinely part-heard at trial could only be
--      represented by creating it and then clicking through eight cells
--      on the board. Nothing here changes that generated column -- the
--      new provenance columns below simply let a file that legitimately
--      starts mid-flow carry its own explanation, so it does not read as
--      a data-entry error later.
--
-- SCOPE: a callover is a record of a sitting. It never mutates
-- docket_matter_status on its own -- "Struck out" / "Concluded" are
-- recorded as an outcome, and completing the matter stays an explicit,
-- separate act by the magistrate. Silently completing judicial files
-- from a dropdown is the wrong default.
--
-- Setting a next date is NOT done here. The client calls the existing
-- capacity-checked set_docket_matter_next_date() (0078/0119), so a
-- callover adjournment gets the same capacity ceiling, the same override
-- path, and the same adjournment semantics (prior event marked completed
-- and stamped "Adjourned to ...") as every other surface. `next_date`
-- below is a denormalised mirror for the sitting record only, never the
-- source of truth for scheduling.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Provenance on docket_matters -- why a file may start mid-flow
-- ----------------------------------------------------------------------------

alter table public.docket_matters
  add column if not exists brought_forward_from text,
  add column if not exists brought_forward_at date;

comment on column public.docket_matters.brought_forward_from is
  'Free text: the predecessor magistrate, transferring court, or prior file reference this matter came from. Set only when a matter is entered mid-flow (already arraigned, part-heard, etc.). NULL for an ordinary new matter.';
comment on column public.docket_matters.brought_forward_at is
  'The date this matter entered THIS docket, which is not its commencement date. Provenance only -- never used for scheduling or capacity.';

-- ----------------------------------------------------------------------------
-- 2. docket_callovers -- the sitting
-- ----------------------------------------------------------------------------

create table if not exists public.docket_callovers (
  id uuid primary key default gen_random_uuid(),
  court_id uuid not null references public.courts (id) on delete restrict,
    -- RESTRICT, matching the Court-Anchored Docket's judicial-history
    -- convention: a sitting that happened is not erased by later
    -- reference-data housekeeping.
  callover_date date not null,
  status text not null default 'draft'
    check (status in ('draft', 'in_progress', 'completed')),
  title text,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  last_updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.docket_callovers is
  'One callover sitting: a court, a date, and the list of matters called. A record of what happened, not a scheduling mechanism -- next dates are always written through set_docket_matter_next_date().';

-- One OPEN callover per court per day. A genuine second sitting is still
-- possible once the first is completed; this only stops two concurrent
-- open lists for the same court and date drifting apart.
create unique index if not exists docket_callovers_open_per_court_date_idx
  on public.docket_callovers (court_id, callover_date)
  where status <> 'completed';

create index if not exists docket_callovers_court_date_idx
  on public.docket_callovers (court_id, callover_date desc);

-- ----------------------------------------------------------------------------
-- 3. docket_callover_items -- one row per matter called
-- ----------------------------------------------------------------------------

create table if not exists public.docket_callover_items (
  id uuid primary key default gen_random_uuid(),
  callover_id uuid not null references public.docket_callovers (id) on delete cascade,
  docket_matter_id uuid not null references public.docket_matters (id) on delete restrict,
    -- RESTRICT for the same reason shares uses it (0037/0121): a matter
    -- that was called at a sitting is part of that sitting's record. The
    -- 0120 purge path deletes callover items explicitly (section 8 below)
    -- so a lawful bin-then-purge is never blocked by this.
  sort_order integer not null default 0,
    -- Deliberately NOT named `position` -- that collides with the SQL
    -- position() function and forces quoting at every call site.
  called_at timestamptz,
    -- NULL = not yet reached in the sitting.
  outcome text,
    -- Unconstrained text with a curated client-side vocabulary, matching
    -- docket_events.event_type / outcome_at_event (0024): any pre-existing
    -- or future wording stays representable and is never coerced.
  next_date date,
    -- Mirror of what set_docket_matter_next_date() actually scheduled, so
    -- the sitting record reads correctly later even if the matter is
    -- adjourned again afterwards. Never the source of truth.
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  last_updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (callover_id, docket_matter_id)
);

comment on table public.docket_callover_items is
  'One matter called at one callover. outcome is free text with a curated client vocabulary; next_date mirrors what set_docket_matter_next_date() scheduled and is never authoritative.';

create index if not exists docket_callover_items_callover_idx
  on public.docket_callover_items (callover_id, sort_order, created_at);

create index if not exists docket_callover_items_matter_idx
  on public.docket_callover_items (docket_matter_id);

-- ----------------------------------------------------------------------------
-- 4. Provenance guards -- created_by / last_updated_by are server-set
-- ----------------------------------------------------------------------------

create or replace function public.callover_provenance_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
    new.last_updated_by := null;
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.last_updated_by := (select auth.uid());
  end if;
  return new;
end;
$$;

comment on function public.callover_provenance_guard() is
  'Forces created_by/created_at on INSERT and last_updated_by on UPDATE for both callover tables, so a client can never claim authorship of a sitting record. Mirrors docket_matters_guard()''s own provenance handling.';

drop trigger if exists callover_provenance_guard_trigger on public.docket_callovers;
create trigger callover_provenance_guard_trigger
  before insert or update on public.docket_callovers
  for each row execute function public.callover_provenance_guard();

drop trigger if exists callover_item_provenance_guard_trigger on public.docket_callover_items;
create trigger callover_item_provenance_guard_trigger
  before insert or update on public.docket_callover_items
  for each row execute function public.callover_provenance_guard();

drop trigger if exists set_docket_callovers_updated_at on public.docket_callovers;
create trigger set_docket_callovers_updated_at
  before update on public.docket_callovers
  for each row execute function public.set_updated_at();

drop trigger if exists set_docket_callover_items_updated_at on public.docket_callover_items;
create trigger set_docket_callover_items_updated_at
  before update on public.docket_callover_items
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 5. can_access_callover() -- the items' authority check
--
-- SECURITY DEFINER for the same structural reason has_docket_matter_
-- authority() is (0037): docket_callover_items' own RLS needs to consult
-- its parent callover, and reading that parent through ordinary RLS from
-- inside a policy on the child is exactly the circular dependency this
-- pattern exists to break. Returns only a boolean derived from auth.uid()
-- and the given id -- no row data (not even court_id) is exposed.
-- ----------------------------------------------------------------------------

create or replace function public.can_access_callover(p_callover_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.docket_callovers co
    where co.id = p_callover_id
      and ((select public.can_access_court(co.court_id)) or (select public.is_admin()))
  );
$$;

comment on function public.can_access_callover(uuid) is
  'True if the caller currently sits (or administers) the court a callover belongs to. SECURITY DEFINER so docket_callover_items'' RLS can consult its parent without recursing through the parent''s own policy.';

revoke all on function public.can_access_callover(uuid) from public, anon;
grant execute on function public.can_access_callover(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. RLS -- court-scoped, following clerk_courts (0087)
-- ----------------------------------------------------------------------------

alter table public.docket_callovers enable row level security;
alter table public.docket_callover_items enable row level security;

drop policy if exists "Court staff can view callovers" on public.docket_callovers;
create policy "Court staff can view callovers"
  on public.docket_callovers for select
  using ((select public.can_access_court(court_id)) or (select public.is_admin()));

drop policy if exists "Court staff can create callovers" on public.docket_callovers;
create policy "Court staff can create callovers"
  on public.docket_callovers for insert
  with check ((select public.can_access_court(court_id)) or (select public.is_admin()));

drop policy if exists "Court staff can update callovers" on public.docket_callovers;
create policy "Court staff can update callovers"
  on public.docket_callovers for update
  using ((select public.can_access_court(court_id)) or (select public.is_admin()))
  with check ((select public.can_access_court(court_id)) or (select public.is_admin()));

-- DELETE is deliberately limited to a still-draft sitting: a draft is a
-- list being assembled, so removing one destroys no record of anything
-- that happened. Once a callover is in progress or completed it is a
-- judicial record and stays, matching every other add/revoke-only table
-- in this schema.
drop policy if exists "Court staff can delete a draft callover" on public.docket_callovers;
create policy "Court staff can delete a draft callover"
  on public.docket_callovers for delete
  using (
    status = 'draft'
    and ((select public.can_access_court(court_id)) or (select public.is_admin()))
  );

drop policy if exists "Court staff can view callover items" on public.docket_callover_items;
create policy "Court staff can view callover items"
  on public.docket_callover_items for select
  using ((select public.can_access_callover(callover_id)));

drop policy if exists "Court staff can add callover items" on public.docket_callover_items;
create policy "Court staff can add callover items"
  on public.docket_callover_items for insert
  with check (
    (select public.can_access_callover(callover_id))
    -- The matter must be one the caller can actually work on. Without
    -- this, a callover could list a matter the magistrate has no Docket
    -- authority over and expose its case number through the item row.
    and (select public.can_edit_docket_matter(docket_matter_id))
  );

drop policy if exists "Court staff can update callover items" on public.docket_callover_items;
create policy "Court staff can update callover items"
  on public.docket_callover_items for update
  using ((select public.can_access_callover(callover_id)))
  with check ((select public.can_access_callover(callover_id)));

-- An item may be removed while it has not yet been called. Once called_at
-- is set, the fact that the matter WAS called is part of the record.
drop policy if exists "Court staff can remove an uncalled item" on public.docket_callover_items;
create policy "Court staff can remove an uncalled item"
  on public.docket_callover_items for delete
  using (
    called_at is null
    and (select public.can_access_callover(callover_id))
  );

-- ----------------------------------------------------------------------------
-- 7. Populate a callover from a date's own list
--
-- SECURITY INVOKER: every matter inserted is filtered by the caller's own
-- can_edit_docket_matter(), and the INSERT still passes through the RLS
-- policy above -- this is a convenience for assembling a thirty-matter
-- list in one round trip, never a way to reach a matter the caller could
-- not already reach.
-- ----------------------------------------------------------------------------

create or replace function public.populate_callover_from_date(
  p_callover_id uuid,
  p_date date default null
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_court_id uuid;
  v_date date;
  v_count integer := 0;
begin
  select co.court_id, coalesce(p_date, co.callover_date)
    into v_court_id, v_date
  from public.docket_callovers co
  where co.id = p_callover_id;

  if v_court_id is null then
    raise exception 'That callover could not be found, or you no longer have access to it.';
  end if;

  insert into public.docket_callover_items (callover_id, docket_matter_id, sort_order)
  select
    p_callover_id,
    dm.id,
    row_number() over (order by dm.case_number, dm.matter_title)
  from public.docket_matters dm
  where dm.court_id = v_court_id
    and dm.deleted_at is null
    and exists (
      select 1 from public.docket_events e
      where e.docket_matter_id = dm.id
        and e.scheduled_date = v_date
        and e.event_status not in ('cancelled', 'entered_in_error')
    )
  on conflict (callover_id, docket_matter_id) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.populate_callover_from_date(uuid, date) is
  'Adds every live matter at the callover''s court with an appearance on the given date (defaults to the callover''s own date). SECURITY INVOKER -- RLS and can_edit_docket_matter() still apply to every row. Idempotent: re-running adds only what is missing.';

revoke all on function public.populate_callover_from_date(uuid, date) from public, anon;
grant execute on function public.populate_callover_from_date(uuid, date) to authenticated;

-- ----------------------------------------------------------------------------
-- 8. Keep the 0120 purge path working
--
-- docket_callover_items.docket_matter_id is ON DELETE RESTRICT, so a
-- matter that was ever called could not be hard-purged without this.
-- Callover items are removed alongside the matter's other owned rows, in
-- the same function, so the 7-day bin purge stays a single atomic act.
-- The parent callover itself is untouched -- the sitting still happened.
-- ----------------------------------------------------------------------------

create or replace function public.purge_docket_matter_row(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_id is null then
    return;
  end if;

  delete from public.docket_event_calendar_links
  where docket_event_id in (
    select id from public.docket_events where docket_matter_id = p_id
  );

  delete from public.docket_events where docket_matter_id = p_id;
  delete from public.docket_matter_parties where docket_matter_id = p_id;
  delete from public.docket_matter_tags where docket_matter_id = p_id;
  delete from public.docket_matter_assignments where docket_matter_id = p_id;
  delete from public.shares where item_type = 'docket_matter' and item_id = p_id;
  delete from public.docket_matter_judgments where docket_matter_id = p_id;
  delete from public.docket_matter_case_law where docket_matter_id = p_id;
  delete from public.quick_code_docket_matters where docket_matter_id = p_id;
  delete from public.bookmarks where entity_type = 'docket_matter' and entity_id = p_id;
  delete from public.bench_notes where entity_type = 'docket_matter' and entity_id = p_id;
  delete from public.docket_callover_items where docket_matter_id = p_id;

  delete from public.docket_matters where id = p_id;
end;
$$;

comment on function public.purge_docket_matter_row(uuid) is
  'Internal hard-delete of one Docket Matter and matter-owned children, including its callover items (0129). Not granted to authenticated. Called only by purge_docket_matter / purge_expired_docket_matters.';

revoke execute on function public.purge_docket_matter_row(uuid) from public;
revoke execute on function public.purge_docket_matter_row(uuid) from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 9. Audit -- reuses the generic writer (0009/0048)
--
-- Captured unredacted, matching docket_events: a callover is an
-- institutional record of a sitting, not private judicial work product.
-- ----------------------------------------------------------------------------

drop trigger if exists audit_docket_callovers on public.docket_callovers;
create trigger audit_docket_callovers
  after insert or update or delete on public.docket_callovers
  for each row execute function public.audit_trigger_fn();

drop trigger if exists audit_docket_callover_items on public.docket_callover_items;
create trigger audit_docket_callover_items
  after insert or update or delete on public.docket_callover_items
  for each row execute function public.audit_trigger_fn();
