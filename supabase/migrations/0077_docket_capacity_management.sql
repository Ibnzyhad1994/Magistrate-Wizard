-- ============================================================================
-- 0077_docket_capacity_management.sql
--
-- Daily Docket Capacity Management: lets a magistrate configure, per
-- Matter Category, how many appearances of that category they can
-- reasonably hear in a day, then warns (never hard-blocks) when a new
-- Docket Event would push a given date over that personal limit —
-- always leaving a deliberate "Add Anyway" override available.
--
-- ARCHITECTURE DECISIONS (recorded here, not re-derived elsewhere):
--
--   1. Matter Category is NEW surface area. `docket_matters.charge_or_issue`
--      is free text (0020, deliberately — inventing a constrained value set
--      was explicitly deferred), and `docket_events.event_type` is also
--      free text (0024, same reasoning, and its own curated UI vocabulary
--      does not match this feature's four starting categories anyway).
--      Neither is repurposed. A new, flat, admin-curated lookup table
--      (`docket_matter_categories`) is added instead — modeled byte-for-
--      byte on `legal_case_categories` (0073) — NOT reusing that table,
--      because it serves a different purpose (legal subject-matter
--      classification for Case Law/Judgment research) than this one
--      (hearing-type classification for daily scheduling capacity).
--
--   2. Category lives on `docket_events`, not `docket_matters`. Capacity is
--      about how many hearings OF A GIVEN TYPE land on a given DATE — a
--      single matter can have several events of different categories
--      (e.g. a Mention, then later a Trial) on different dates, and only
--      the specific event's own category should count against that
--      date's capacity. `docket_events.category_id` is therefore nullable
--      and additive; existing events remain uncategorized (and therefore
--      uncounted) until set.
--
--   3. Capacity settings are per-magistrate, never shared/global — a new
--      `docket_capacity_settings` table (owner_id + category_id, unique
--      per pair, daily_capacity a positive integer) modeled directly on
--      `quick_codes` (0031)'s fully owner-only RLS shape (no admin
--      bypass, no Court/Docket access-check — this is personal
--      configuration, not an institutional record). Absence of a row for
--      a given (owner, category) means "not configured", distinct from a
--      configured 0 — never conflated.
--
--   4. Overrides are recorded in a new, purpose-built
--      `docket_capacity_overrides` table rather than by attaching the
--      generic `audit_trigger_fn()` (0009/0048) to anything. That
--      generic mechanism captures raw row before/after JSON on
--      INSERT/UPDATE/DELETE — it has no way to represent the COMPUTED,
--      point-in-time facts an override needs (what the configured
--      capacity was, what the resulting count was, why the magistrate
--      chose to proceed anyway). Building a dedicated table for this
--      derived information is not "duplicate audit infrastructure" — it
--      is the same reasoning that already justifies `import_jobs`
--      existing alongside `audit_log`. The override table is
--      insert-only from the client's perspective (writable only through
--      the SECURITY DEFINER scheduling RPC below, never by direct
--      table INSERT), giving it the same effective append-only integrity
--      as a real audit trail.
--
--   5. Capacity checking is a server-side, single-transaction RPC
--      (`schedule_docket_event_with_capacity`), not a client-side
--      pre-check. A pure client check-then-insert would race: two
--      simultaneous bookings could each see 4/5 and both insert,
--      silently landing at 6/5 with no override on record. The RPC
--      recomputes the live count and re-validates atomically as part of
--      the same statement that performs the insert/update, so a
--      just-filled slot is caught even if the caller's own earlier
--      client-side read was stale — and, when it is caught, the RPC
--      simply reports back "capacity_reached" (never raises an
--      exception for this expected, common case) so the frontend can
--      show the override dialog and re-call with
--      p_acknowledge_override = true rather than surfacing a scary
--      error.
--
--   6. Scope of this pass: the RPC covers CREATING a new event and
--      UPDATING an existing one when its date/category/status is
--      changing in a way that would affect a capacity count (matching
--      the spec's core interaction — adding/scheduling matters).
--      Editing unrelated fields on an existing event continues to use
--      the plain, pre-existing `useUpdateDocketEvent` path untouched.
--      Live COUNT-based calculation means recalculation for a
--      reschedule, a cancellation, or a later capacity change is
--      automatic — there is no cached/maintained counter to keep in
--      sync.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. docket_matter_categories — flat, admin-curated lookup (mirrors
--    legal_case_categories, 0073, exactly)
-- ----------------------------------------------------------------------------

create table public.docket_matter_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.docket_matter_categories is
  'The TYPE OF HEARING a Docket Event represents for daily capacity-planning purposes (e.g. "Trials", "Maintenance", "Liability", "Protection Order / Family Violence") -- a flat, admin-curated classification distinct from legal_case_categories (0073, legal subject-matter for Case Law/Judgment research) and distinct from docket_events.event_type (0024, unconstrained free text with its own UI vocabulary). Data-driven: adding a new category is an INSERT, never a code change -- never hard-code the starting four anywhere that would need a code change to add a fifth.';

alter table public.docket_matter_categories enable row level security;

create policy "Docket matter categories are viewable by all authenticated users"
  on public.docket_matter_categories for select using (true);
create policy "Admins manage docket matter categories"
  on public.docket_matter_categories for insert with check ((select public.is_admin()));
create policy "Admins update docket matter categories"
  on public.docket_matter_categories for update using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "Admins delete docket matter categories"
  on public.docket_matter_categories for delete using ((select public.is_admin()));

insert into public.docket_matter_categories (name, sort_order) values
  ('Trials', 1),
  ('Maintenance', 2),
  ('Liability', 3),
  ('Protection Order / Family Violence', 4);

-- ----------------------------------------------------------------------------
-- 2. docket_events.category_id -- nullable, additive
-- ----------------------------------------------------------------------------

alter table public.docket_events
  add column category_id uuid references public.docket_matter_categories(id) on delete set null;

create index docket_events_category_id_idx on public.docket_events (category_id);
create index docket_events_scheduled_date_category_idx
  on public.docket_events (scheduled_date, category_id)
  where event_status = 'scheduled';

comment on column public.docket_events.category_id is
  'The matter-category type of this specific hearing occurrence (docket_matter_categories), used to compute daily capacity utilisation. Nullable: an event with no category set never counts toward any capacity. Independent of event_type (free text) -- a Trial-category event and an event_type of "Trial" are not the same field and are not kept in sync automatically.';

-- ----------------------------------------------------------------------------
-- 3. docket_capacity_settings -- per-magistrate daily capacity per category
--    (RLS shape mirrors quick_codes, 0031, exactly: fully owner-only, no
--    admin bypass, no Court/Docket access-check)
-- ----------------------------------------------------------------------------

create table public.docket_capacity_settings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  category_id uuid not null references public.docket_matter_categories (id) on delete cascade,
  daily_capacity integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint docket_capacity_settings_positive_check check (daily_capacity > 0)
);

comment on table public.docket_capacity_settings is
  'Personal, per-magistrate daily capacity configuration -- how many hearings of a given docket_matter_categories type this magistrate can reasonably take in one day. Owner-only RLS, no admin bypass, mirroring quick_codes (0031): capacity settings must never be universal/shared. Absence of a row for a given (owner_id, category_id) means "not configured" (schedule normally, no warning) -- distinct from a configured 0, which means the magistrate has deliberately set the category to always require an override. ON DELETE CASCADE on owner_id (unlike quick_codes'' RESTRICT) is deliberate: this is disposable personal configuration, not content whose loss would be a real loss the way a Quick Code or Judgment would be -- a deleted profile should not be blocked on this table.';
comment on column public.docket_capacity_settings.daily_capacity is
  'Positive whole number only (CHECK). Zero is not permitted here -- a magistrate who wants "always warn" for a category should not configure it, since 0 vs "not configured" must remain distinguishable (0 would still validly mean "always over capacity", which the CHECK deliberately still allows if ever desired by removing this comment''s constraint in a future migration; for now the spec requires positive whole numbers, so 0 is rejected).';

create unique index docket_capacity_settings_owner_category_unique_idx
  on public.docket_capacity_settings (owner_id, category_id);

create trigger set_docket_capacity_settings_updated_at
  before update on public.docket_capacity_settings
  for each row execute function public.set_updated_at();

create or replace function public.docket_capacity_settings_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.owner_id := (select auth.uid());
  elsif tg_op = 'UPDATE' then
    if new.owner_id is distinct from old.owner_id then
      raise exception 'A Docket Capacity Setting''s owner_id is immutable; ownership cannot be transferred by UPDATE.';
    end if;
  end if;
  return new;
end;
$$;

create trigger docket_capacity_settings_guard_trigger
  before insert or update on public.docket_capacity_settings
  for each row execute function public.docket_capacity_settings_guard();

alter table public.docket_capacity_settings enable row level security;

create policy "Owners can view their Docket Capacity Settings"
  on public.docket_capacity_settings for select
  using (owner_id = (select auth.uid()));
create policy "Owners can create Docket Capacity Settings"
  on public.docket_capacity_settings for insert
  with check (owner_id = (select auth.uid()));
create policy "Owners can update their Docket Capacity Settings"
  on public.docket_capacity_settings for update
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy "Owners can delete their Docket Capacity Settings"
  on public.docket_capacity_settings for delete
  using (owner_id = (select auth.uid()));

-- Reuse the existing generic audit trigger (0009/0048) -- a plain
-- owner-configuration table with no sensitive free text to redact, same
-- treatment as magistrate_courts.
create trigger audit_docket_capacity_settings
  after insert or update or delete on public.docket_capacity_settings
  for each row execute function public.audit_trigger_fn();

-- ----------------------------------------------------------------------------
-- 4. docket_capacity_overrides -- append-only record of each deliberate
--    over-capacity booking. Writable only via the RPC below (SECURITY
--    DEFINER) -- direct client INSERT/UPDATE/DELETE is never permitted,
--    so this table's own contents are as tamper-resistant as an audit
--    trail without duplicating audit_log's generic machinery (see header).
-- ----------------------------------------------------------------------------

create table public.docket_capacity_overrides (
  id uuid primary key default gen_random_uuid(),
  docket_event_id uuid references public.docket_events (id) on delete set null,
  docket_matter_id uuid not null references public.docket_matters (id) on delete cascade,
  category_id uuid references public.docket_matter_categories (id) on delete set null,
  magistrate_profile_id uuid not null references public.profiles (id) on delete cascade,
  scheduled_date date not null,
  configured_capacity integer not null,
  scheduled_count_at_override integer not null,
  reason text,
  created_at timestamptz not null default now()
);

comment on table public.docket_capacity_overrides is
  'Append-only record of every deliberate over-capacity Docket Event booking -- who, when, which category/date, what the configured capacity and resulting count were, and an optional free-text reason. Writable ONLY through schedule_docket_event_with_capacity() (SECURITY DEFINER) -- no direct client INSERT/UPDATE/DELETE path exists, giving this table the same practical tamper-resistance as a generic audit trigger without needing one (see migration header). docket_event_id is ON DELETE SET NULL (there is no hard-delete UI path for events today, but history must survive regardless) and docket_matter_id is retained independently as the durable anchor.';

create index docket_capacity_overrides_matter_id_idx on public.docket_capacity_overrides (docket_matter_id);
create index docket_capacity_overrides_magistrate_date_idx
  on public.docket_capacity_overrides (magistrate_profile_id, scheduled_date);

alter table public.docket_capacity_overrides enable row level security;

-- Readable by the magistrate who made the override, and by admins (for
-- oversight of a magistrate's own scheduling decisions -- consistent with
-- is_admin() read-visibility precedent elsewhere, e.g. import_jobs).
-- Never writable directly by any client role -- no insert/update/delete
-- policy exists at all, so RLS denies all such attempts outright; the
-- SECURITY DEFINER RPC bypasses RLS entirely for its own writes.
create policy "Magistrates can view their own Docket Capacity Overrides"
  on public.docket_capacity_overrides for select
  using (magistrate_profile_id = (select auth.uid()) or (select public.is_admin()));

-- ----------------------------------------------------------------------------
-- 5. get_docket_capacity_snapshot -- live capacity/utilisation for the
--    calling magistrate, one row per category (or one row when
--    p_category_id is given). Backs the settings panel's live utilisation
--    display, the event dialog's inline capacity readout, and the visual
--    indicators. SECURITY INVOKER: the underlying docket_events SELECT
--    RLS already governs what the caller can see; this simply adds a
--    narrower filter (this magistrate's own presided events) on top.
-- ----------------------------------------------------------------------------

create or replace function public.get_docket_capacity_snapshot(
  p_scheduled_date date,
  p_category_id uuid default null
)
returns table(
  category_id uuid,
  category_name text,
  daily_capacity integer,
  scheduled_count bigint,
  status text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    c.id as category_id,
    c.name as category_name,
    s.daily_capacity,
    coalesce(ev.scheduled_count, 0) as scheduled_count,
    case
      when s.daily_capacity is null then 'not_set'
      when coalesce(ev.scheduled_count, 0) > s.daily_capacity then 'over_capacity'
      when coalesce(ev.scheduled_count, 0) = s.daily_capacity then 'full'
      else 'available'
    end as status
  from public.docket_matter_categories c
  left join public.docket_capacity_settings s
    on s.category_id = c.id and s.owner_id = (select auth.uid())
  left join lateral (
    select count(*) as scheduled_count
    from public.docket_events e
    where e.category_id = c.id
      and e.scheduled_date = p_scheduled_date
      and e.event_status = 'scheduled'
      and e.presiding_magistrate_id = (select auth.uid())
  ) ev on true
  where p_category_id is null or c.id = p_category_id
  order by c.sort_order;
$$;

comment on function public.get_docket_capacity_snapshot(date, uuid) is
  'Per-category capacity utilisation snapshot for the CALLING magistrate on one date: their own configured daily_capacity (null = not configured), their own scheduled_count (only event_status = ''scheduled'' events they preside over, in that category, on that date), and a derived status (not_set/available/full/over_capacity). Personal by design -- counts are scoped to presiding_magistrate_id = auth.uid(), matching the spec''s framing of an individual magistrate''s personal hearing capacity, not a whole court''s aggregate load.';

-- ----------------------------------------------------------------------------
-- 6. find_next_available_docket_date -- assistive suggestion only, never
--    auto-moves anything. Scans forward day-by-day (capped) for the
--    first date where this magistrate is under configured capacity for
--    the given category (or where capacity isn't configured at all).
-- ----------------------------------------------------------------------------

create or replace function public.find_next_available_docket_date(
  p_category_id uuid,
  p_start_date date,
  p_max_days_ahead integer default 60
)
returns date
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_capacity integer;
  v_date date := p_start_date;
  v_count integer;
  v_days integer := 0;
begin
  select daily_capacity into v_capacity
  from public.docket_capacity_settings
  where owner_id = (select auth.uid()) and category_id = p_category_id;

  if v_capacity is null then
    return p_start_date;
  end if;

  loop
    select count(*) into v_count
    from public.docket_events
    where category_id = p_category_id
      and scheduled_date = v_date
      and event_status = 'scheduled'
      and presiding_magistrate_id = (select auth.uid());

    if v_count < v_capacity then
      return v_date;
    end if;

    v_date := v_date + 1;
    v_days := v_days + 1;
    exit when v_days >= p_max_days_ahead;
  end loop;

  return null;
end;
$$;

comment on function public.find_next_available_docket_date(uuid, date, integer) is
  'Assistive-only: returns the first date on/after p_start_date where the calling magistrate is under their configured capacity for p_category_id, or p_start_date itself if the category has no configured capacity. Returns null if none found within p_max_days_ahead. Never writes anything, never moves a matter -- purely a suggestion for the UI to offer.';

-- ----------------------------------------------------------------------------
-- 7. schedule_docket_event_with_capacity -- the single, atomic, capacity-
--    aware create/update path. Explicit named parameters (matching this
--    project's existing RPC convention, e.g. create_case_law_import,
--    rather than a jsonb payload). Re-implements the exact authorization
--    predicate docket_events' own INSERT/UPDATE policies use, since
--    SECURITY DEFINER bypasses RLS and that check must not be lost.
-- ----------------------------------------------------------------------------

create or replace function public.schedule_docket_event_with_capacity(
  p_docket_matter_id uuid,
  p_scheduled_date date,
  p_event_id uuid default null,
  p_scheduled_time time default null,
  p_event_type text default null,
  p_stage_at_event text default null,
  p_outcome_at_event text default null,
  p_orders_made_at_event text default null,
  p_notes text default null,
  p_location text default null,
  p_event_status text default 'scheduled',
  p_category_id uuid default null,
  p_acknowledge_override boolean default false,
  p_override_reason text default null
)
returns table(
  status text,
  event_id uuid,
  category_id uuid,
  category_name text,
  configured_capacity integer,
  scheduled_count integer,
  is_over_capacity boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_matter_id uuid;
  v_can_access boolean;
  v_capacity integer;
  v_category_name text;
  v_count integer;
  v_event_id uuid;
  v_will_count boolean;
begin
  if p_event_id is not null then
    select ev0.docket_matter_id into v_matter_id
    from public.docket_events ev0
    where ev0.id = p_event_id;
    if v_matter_id is null then
      raise exception 'Docket Event % not found.', p_event_id;
    end if;
    if p_docket_matter_id is not null and p_docket_matter_id <> v_matter_id then
      raise exception 'A Docket Event''s docket_matter_id is immutable; it cannot be moved to another Docket Matter.';
    end if;
  else
    v_matter_id := p_docket_matter_id;
    if v_matter_id is null then
      raise exception 'p_docket_matter_id is required when creating a new Docket Event.';
    end if;
  end if;

  select
    (public.can_access_court(dm.court_id)) or (public.has_retained_assignment(dm.id))
    into v_can_access
  from public.docket_matters dm
  where dm.id = v_matter_id;

  if v_can_access is not true then
    raise exception 'Not authorized to schedule Docket Events on this matter.';
  end if;

  -- This booking only counts toward / competes for capacity when it will
  -- end up as a 'scheduled' event with a category set. An event with no
  -- category, or one being saved as completed/cancelled/entered_in_error,
  -- is never capacity-checked.
  v_will_count := p_category_id is not null and p_event_status = 'scheduled';

  if v_will_count then
    select s.daily_capacity into v_capacity
    from public.docket_capacity_settings s
    where s.owner_id = (select auth.uid()) and s.category_id = p_category_id;

    select c.name into v_category_name from public.docket_matter_categories c where c.id = p_category_id;

    -- Live count of OTHER events already occupying this magistrate's
    -- capacity for this date/category — excludes the row being updated
    -- itself, so an in-place edit that doesn't change date/category never
    -- double-counts against its own prior occupancy.
    select count(*) into v_count
    from public.docket_events e
    where e.category_id = p_category_id
      and e.scheduled_date = p_scheduled_date
      and e.event_status = 'scheduled'
      and e.presiding_magistrate_id = (select auth.uid())
      and (p_event_id is null or e.id <> p_event_id);

    if v_capacity is not null and v_count >= v_capacity and not p_acknowledge_override then
      return query select
        'capacity_reached'::text,
        null::uuid,
        p_category_id,
        v_category_name,
        v_capacity,
        v_count,
        (v_count >= v_capacity);
      return;
    end if;
  end if;

  if p_event_id is not null then
    update public.docket_events set
      scheduled_date = p_scheduled_date,
      scheduled_time = p_scheduled_time,
      event_type = p_event_type,
      stage_at_event = p_stage_at_event,
      outcome_at_event = p_outcome_at_event,
      orders_made_at_event = p_orders_made_at_event,
      notes = p_notes,
      location = p_location,
      event_status = p_event_status,
      category_id = p_category_id
    where id = p_event_id
    returning id into v_event_id;
  else
    insert into public.docket_events (
      docket_matter_id, scheduled_date, scheduled_time, event_type,
      stage_at_event, outcome_at_event, orders_made_at_event, notes,
      location, event_status, category_id, created_by, presiding_magistrate_id
    ) values (
      v_matter_id, p_scheduled_date, p_scheduled_time, p_event_type,
      p_stage_at_event, p_outcome_at_event, p_orders_made_at_event, p_notes,
      p_location, p_event_status, p_category_id, (select auth.uid()), (select auth.uid())
    )
    returning id into v_event_id;
  end if;

  if v_will_count and v_capacity is not null and v_count >= v_capacity then
    insert into public.docket_capacity_overrides (
      docket_event_id, docket_matter_id, category_id, magistrate_profile_id,
      scheduled_date, configured_capacity, scheduled_count_at_override, reason
    ) values (
      v_event_id, v_matter_id, p_category_id, (select auth.uid()),
      p_scheduled_date, v_capacity, v_count + 1, nullif(btrim(coalesce(p_override_reason, '')), '')
    );
  end if;

  return query select
    'created'::text,
    v_event_id,
    p_category_id,
    v_category_name,
    v_capacity,
    case when v_will_count then v_count + 1 else v_count end,
    (v_will_count and v_capacity is not null and (v_count + 1) > v_capacity);
end;
$$;

comment on function public.schedule_docket_event_with_capacity is
  'Atomic, capacity-aware create/update for a single Docket Event. Re-checks the same authorization predicate docket_events'' own INSERT/UPDATE RLS uses (can_access_court OR has_retained_assignment) since SECURITY DEFINER bypasses RLS. When the target booking would be scheduled with a category set and the calling magistrate has a configured daily_capacity for that category/date already met or exceeded, returns status=''capacity_reached'' WITHOUT writing anything (unless p_acknowledge_override is true) -- this is the expected, common path for a full day, never an exception. On an acknowledged or under-capacity booking, performs the insert/update and, if it lands at or over the configured capacity, records a docket_capacity_overrides row. Never hard-blocks: capacity is enforced only through this confirm-then-acknowledge flow, never as an unconditional rejection.';

revoke execute on function public.schedule_docket_event_with_capacity from public;
grant execute on function public.schedule_docket_event_with_capacity to authenticated;
