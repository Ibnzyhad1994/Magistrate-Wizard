-- Magistrate Wizard — Docket Events (Court appearances/hearing occurrences)
-- One docket_events row represents one scheduled/actual Court appearance
-- or hearing occurrence associated with exactly one Docket Matter. This
-- is NOT a second access-control anchor: Court and District are obtained
-- exclusively through the parent docket_matters row — court_id and
-- district_id are deliberately NOT duplicated here.
--
-- ACCESS MODEL: fully inherited from the parent Docket Matter. SELECT,
-- INSERT, and UPDATE all require the same two-path predicate
-- docket_matters itself uses — can_access_court(parent.court_id) OR
-- has_retained_assignment(parent.id) — via an EXISTS lookup. This means
-- a retained/part-heard magistrate may create and update appearances on
-- the one matter they remain responsible for, even after losing
-- ordinary Court-wide access to that Court's other matters. The future
-- shares path is intentionally NOT added here, per the incremental RLS
-- staging decision already established for docket_matters. No DELETE
-- policy, no admin bypass, anywhere.
--
-- ADJOURNMENTS: create a NEW docket_events row for the new appearance
-- date. The historical appearance's own scheduled_date is never
-- overwritten. This is what keeps derived previous/next-appearance
-- chronology historically accurate — e.g. an appearance on 10 August
-- that is adjourned to 3 September leaves the 10 August event
-- permanently in place, with a new 3 September event created alongside
-- it.
--
-- PRESIDING MAGISTRATE PROVENANCE: presiding_magistrate_id records who
-- actually presided over/heard this specific appearance. It is judicial
-- provenance ONLY, never an access-control field. It is forced to
-- auth.uid() at creation (a client cannot forge another magistrate as
-- presiding by supplying a different profile id), and is not freely
-- client-rewritable afterward. The one legitimate exception is the
-- column's own ON DELETE SET NULL action firing when a presiding
-- magistrate's profile is later deleted — handled with the same
-- carefully-reasoned FK-nulling pattern established in migration 0022
-- for docket_matter_assignments.profile_id/granted_by: the trigger
-- permits exactly that old-not-null/new-null transition, and the UPDATE
-- policy's WITH CHECK independently requires presiding_magistrate_id IS
-- NOT NULL, which makes that transition structurally impossible via any
-- RLS-governed client path — so the trigger can safely treat it as
-- originating only from the FK action. Unlike docket_matter_assignments'
-- profile_id, presiding_magistrate_id is NOT required to equal the
-- *current* updater's auth.uid() after creation — it records who
-- originally presided, an immutable historical fact, not whoever is
-- currently correcting logistics on the row. A future controlled
-- correction/admin workflow may need to legitimately re-record a
-- different presiding magistrate in some circumstance; that workflow is
-- explicitly NOT built here, and creation-time provenance is not
-- weakened in anticipation of it.
--
-- EVENT LIFECYCLE: no hard DELETE, ever. event_status is constrained
-- text (not a Postgres enum, matching the docket_matter_assignments.reason
-- pattern), initially: scheduled, completed, cancelled, entered_in_error.
-- A mistaken event is corrected to entered_in_error, never deleted; a
-- cancelled sitting remains historically visible as cancelled. Only the
-- narrowest trigger protection needed is applied — docket_matter_id is
-- locked, presiding_magistrate_id provenance is locked (subject to the
-- FK-nulling exception above) — no full immutable event ledger is built
-- here. Ordinary logistical/substantive fields (scheduled_date,
-- scheduled_time, event_type, stage_at_event, outcome_at_event,
-- orders_made_at_event, notes, location, event_status) remain freely
-- correctable by anyone with lawful access to the parent matter.
--
-- OUTLOOK BOUNDARY: the three placeholder columns
-- (external_calendar_provider, external_calendar_event_id,
-- external_calendar_synced_at) reserve the shape for a future calendar
-- sync. No sync logic is built in this migration. Outlook may deal only
-- with appearance logistics (date, time, location); it must never
-- become authoritative for legal substance or judicial access. A CHECK
-- constraint requires external_calendar_provider and
-- external_calendar_event_id to be both NULL or both set together —
-- integrity only, guarding against malformed placeholder identity data,
-- not sync logic. external_calendar_synced_at remains independently
-- nullable.
--
-- EVENT TYPE: event_type is nullable, unconstrained text. The original
-- Addendum 2 proposal (a Postgres enum: first_appearance, arraignment,
-- pretrial, trial, sentencing, review, other) is deliberately NOT built
-- — it was never confirmed in the FINAL specification and is too
-- criminal-specific for the broader Magistrates' Courts Docket. A
-- broader cross-jurisdiction taxonomy is future work, to be designed
-- and migrated deliberately when needed.

-- 1. docket_events table -------------------------------------------------

create table public.docket_events (
  id uuid primary key default gen_random_uuid(),
  docket_matter_id uuid not null references public.docket_matters (id) on delete restrict,
    -- immutable after creation — see the guard trigger below. RESTRICT
    -- matches the docket_matter_assignments.docket_matter_id precedent
    -- (0022); docket_matters itself has no DELETE policy, so this is a
    -- defensive backstop, not an expected operational path
  scheduled_date date not null,
    -- mandatory — a Court appearance is always known by date, even
    -- before a precise sitting time is known
  scheduled_time time,
    -- nullable — never fabricated merely to populate a timestamp
  event_type text,
    -- nullable, deliberately UNCONSTRAINED — see header commentary
  stage_at_event text,
    -- nullable — what stage the matter was at, at this specific
    -- appearance; distinct from docket_matters' own fields
  outcome_at_event text,
    -- nullable — this appearance's outcome, distinct from
    -- docket_matters.outcome
  orders_made_at_event text,
    -- nullable
  notes text,
    -- nullable, free-text
  presiding_magistrate_id uuid default auth.uid() references public.profiles (id) on delete set null,
    -- judicial provenance only — see header commentary. Nullable at the
    -- schema level ONLY to permit the profile's own ON DELETE SET NULL
    -- action to survive a later profile deletion; not nullable in
    -- practice at creation (forced to auth.uid() by the guard trigger
    -- below, independently re-checked by RLS WITH CHECK)
  event_status text not null default 'scheduled'
    check (event_status in ('scheduled', 'completed', 'cancelled', 'entered_in_error')),
    -- constrained text, not an enum, so future legitimate values can be
    -- added without a type change. scheduled = future/planned;
    -- completed = appearance occurred; cancelled = scheduled appearance
    -- did not proceed, remains historically visible; entered_in_error =
    -- row was created incorrectly, retained for audit/history rather
    -- than hard-deleted
  external_calendar_provider text,
    -- nullable, Outlook/calendar-sync placeholder — no sync logic built
  external_calendar_event_id text,
    -- nullable, Outlook/calendar-sync placeholder
  external_calendar_synced_at timestamptz,
    -- nullable, Outlook/calendar-sync placeholder
  location text,
    -- nullable — courtroom/location free text; no separate courtroom
    -- table in this migration
  created_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
    -- trigger-forced at creation; matches docket_matters.created_by
    -- exactly (same semantic role, same ON DELETE RESTRICT choice)
  last_updated_by uuid references public.profiles (id) on delete set null,
    -- trigger-populated on every UPDATE; matches
    -- docket_matters.last_updated_by exactly (same semantic role, same
    -- ON DELETE SET NULL choice)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint docket_events_external_calendar_pair_check check (
    (external_calendar_provider is null and external_calendar_event_id is null)
    or (external_calendar_provider is not null and external_calendar_event_id is not null)
  )
    -- integrity only, not sync logic: prevents a malformed row where
    -- exactly one of the two external-calendar identifiers is set
    -- without the other. external_calendar_synced_at remains
    -- independently nullable either way (a synced row may not yet have
    -- a synced_at timestamp; the pair identifies the external event,
    -- synced_at records when the last sync occurred)
);

comment on table public.docket_events is 'One Court appearance/hearing occurrence per Docket Matter. Court/District are obtained exclusively through the parent docket_matters row and are never duplicated here. Access is fully inherited from the parent Docket Matter via can_access_court()/has_retained_assignment(). Adjournments create a new row; historical appearances are never overwritten or hard-deleted.';
comment on column public.docket_events.docket_matter_id is 'Immutable after creation — an event can never be moved to another Docket Matter. Enforced by docket_events_guard().';
comment on column public.docket_events.presiding_magistrate_id is 'Judicial provenance only, never access control. Forced to auth.uid() at creation; not freely client-rewritable afterward, except for the profile''s own ON DELETE SET NULL action, safely absorbed by docket_events_guard() using the same FK-nulling pattern established in migration 0022.';
comment on column public.docket_events.event_status is 'Constrained to scheduled/completed/cancelled/entered_in_error. A mistaken event is corrected to entered_in_error, never hard-deleted.';
comment on column public.docket_events.event_type is 'Deliberately unconstrained free text in this migration — no vocabulary/enum imposed. The Addendum 2 criminal-specific enum was never confirmed in the FINAL specification and is not built.';

-- 2. updated_at trigger ---------------------------------------------------
-- Reuses the existing public.set_updated_at() from migration 0001.

create trigger set_docket_events_updated_at
  before update on public.docket_events
  for each row
  execute function public.set_updated_at();

-- 3. Indexes ----------------------------------------------------------------

create index docket_events_docket_matter_id_idx on public.docket_events (docket_matter_id);
create index docket_events_scheduled_date_idx on public.docket_events (scheduled_date);
create index docket_events_created_by_idx on public.docket_events (created_by);
create index docket_events_last_updated_by_idx on public.docket_events (last_updated_by);
create index docket_events_presiding_magistrate_id_idx on public.docket_events (presiding_magistrate_id);

-- Prevents importing the same external calendar event twice. Scoped
-- (partial) to rows where BOTH external identifiers are present, so the
-- overwhelming majority of ordinary, non-synced rows (both NULL) are
-- entirely unaffected/excluded from this index.
create unique index docket_events_external_calendar_unique_idx
  on public.docket_events (external_calendar_provider, external_calendar_event_id)
  where external_calendar_provider is not null and external_calendar_event_id is not null;

-- 4. docket_events_guard() — immutability + provenance protection -----------
-- Combines three narrow protections in one BEFORE INSERT OR UPDATE
-- trigger, mirroring the style of docket_matters_guard() (0020):
--   (a) docket_matter_id is immutable — any attempted change on UPDATE
--       is rejected outright with an exception (matching how 0022
--       protects docket_matter_assignments' identity fields, since this
--       is a genuine client-supplied identity value, not a derived one).
--   (b) created_by is forced to auth.uid() at INSERT and force-preserved
--       on every UPDATE. Because created_by is ON DELETE RESTRICT, it
--       can never be nulled by a profile deletion — no special-casing
--       is needed, exactly matching docket_matters_guard().
--   (c) presiding_magistrate_id is forced to auth.uid() at INSERT and
--       force-preserved on ordinary UPDATE — EXCEPT the one legitimate
--       transition where old.presiding_magistrate_id is not null and
--       new.presiding_magistrate_id is null (the profile's own ON
--       DELETE SET NULL action), which is permitted through. The UPDATE
--       policy's WITH CHECK (presiding_magistrate_id IS NOT NULL, see
--       below) independently makes this transition structurally
--       impossible for any RLS-governed client path, so the trigger can
--       safely permit it without needing to identify the caller — the
--       same proof technique used in 0022. Unlike docket_matter_assignments,
--       there is no need for a "reject if anything else also changed"
--       cross-check here, because created_by (the only other
--       provenance column) can never be nulled in the same statement
--       (it is RESTRICT, not SET NULL) — so at most one column on this
--       table can ever be FK-nulled, unlike 0022's two-column case.
--   (d) last_updated_by is set to auth.uid() on every UPDATE, never
--       client-writable, matching docket_matters_guard() exactly —
--       including its behavior during a profile-deletion cascade (the
--       updater's own auth.uid() is recorded, not NULL, exactly as
--       already accepted for docket_matters.last_updated_by in 0020).

create or replace function public.docket_events_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_presiding_nulled boolean;
begin
  if tg_op = 'UPDATE' and new.docket_matter_id is distinct from old.docket_matter_id then
    raise exception 'A Docket Event''s docket_matter_id is immutable; it cannot be moved to another Docket Matter. Create a new event on the correct matter instead.';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
  else
    new.created_by := old.created_by;
  end if;

  if tg_op = 'INSERT' then
    new.presiding_magistrate_id := (select auth.uid());
  else
    v_presiding_nulled := old.presiding_magistrate_id is not null and new.presiding_magistrate_id is null;
    if v_presiding_nulled then
      new.presiding_magistrate_id := null;
    else
      new.presiding_magistrate_id := old.presiding_magistrate_id;
    end if;
  end if;

  if tg_op = 'UPDATE' then
    new.last_updated_by := (select auth.uid());
  end if;

  return new;
end;
$$;

comment on function public.docket_events_guard() is 'BEFORE INSERT OR UPDATE guard combining three protections: docket_matter_id immutability (exception on change), created_by provenance (forced at creation, force-preserved after — safe unconditionally, since created_by is ON DELETE RESTRICT), and presiding_magistrate_id provenance (forced at creation, force-preserved after, except the profile''s own ON DELETE SET NULL transition, which is permitted and independently closed off to client forgery by the UPDATE policy''s WITH CHECK).';

create trigger docket_events_guard_trigger
  before insert or update on public.docket_events
  for each row
  execute function public.docket_events_guard();

-- 5. Row Level Security -------------------------------------------------------
-- Access is fully inherited from the parent Docket Matter via the same
-- two-path predicate docket_matters itself uses. No DELETE policy. No
-- admin bypass, anywhere. The future shares path is intentionally not
-- added here.

alter table public.docket_events enable row level security;

create policy "Magistrates can view Docket Events for accessible Docket Matters"
  on public.docket_events for select
  using (
    exists (
      select 1 from public.docket_matters dm
      where dm.id = docket_events.docket_matter_id
        and (
          (select public.can_access_court(dm.court_id))
          or (select public.has_retained_assignment(dm.id))
        )
    )
  );

create policy "Magistrates can create Docket Events for accessible Docket Matters"
  on public.docket_events for insert
  with check (
    exists (
      select 1 from public.docket_matters dm
      where dm.id = docket_events.docket_matter_id
        and (
          (select public.can_access_court(dm.court_id))
          or (select public.has_retained_assignment(dm.id))
        )
    )
    and created_by = (select auth.uid())
    and presiding_magistrate_id = (select auth.uid())
  );

create policy "Magistrates can update Docket Events for accessible Docket Matters"
  on public.docket_events for update
  using (
    exists (
      select 1 from public.docket_matters dm
      where dm.id = docket_events.docket_matter_id
        and (
          (select public.can_access_court(dm.court_id))
          or (select public.has_retained_assignment(dm.id))
        )
    )
  )
  with check (
    exists (
      select 1 from public.docket_matters dm
      where dm.id = docket_events.docket_matter_id
        and (
          (select public.can_access_court(dm.court_id))
          or (select public.has_retained_assignment(dm.id))
        )
    )
    and presiding_magistrate_id is not null
  );
