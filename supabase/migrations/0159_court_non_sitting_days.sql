-- Magistrate Wizard -- 0159: days the court does not sit
--
-- Problem
--   Nothing in the product knows about weekends or public holidays. A
--   magistrate can adjourn a matter to a Sunday, or to Christmas Day, and
--   neither the next-date dialog nor set_docket_matter_next_date says a
--   word. `find_next_available_docket_date` will happily propose one too.
--
-- Model
--   One table, three scopes, resolved most-specific-first:
--     court_id set     -> that court only
--     district_id set  -> every court in that district
--     both null        -> national
--   A row may not carry both, which the CHECK enforces.
--
--   Weekends are a RULE, not rows. 104 rows a year that must be
--   maintained forever is a trap, and the rule never drifts. `kind =
--   'sitting_exception'` exists so a genuine special Saturday sitting is
--   representable without a schema change, and it beats every other rule.
--
-- Seeding, and what is deliberately NOT seeded
--   Only the FIXED-DATE national holidays are seeded, for 2026 and 2027.
--   Guyana's movable holidays -- Good Friday, Easter Monday, Phagwah,
--   Eid-ul-Adha, Youman Nabi, Diwali -- are declared annually and cannot
--   be computed from a rule. Seeding guesses for them would be inventing
--   data, which this codebase does not do (a value it does not hold
--   renders as "Not recorded", it is never fabricated). They are entered
--   by an administrator each year, and a year with no rows reads as "no
--   non-sitting days recorded", never as "every day is a sitting day".
--
-- Warn, never block
--   is_court_sitting_day() is a read-only predicate. It is deliberately
--   NOT consulted by set_docket_matter_next_date: a magistrate can
--   lawfully sit on a holiday (urgent bail, remand returns, an emergency
--   protection order), so refusing the write would make the software
--   refuse a lawful judicial act. It would also be stricter than the
--   magistrate's own capacity limit, which merely warns.
--
-- Threat model
--   Reference data, modelled byte for byte on docket_matter_categories
--   (0077) and magisterial_districts (0013): SELECT true for any
--   authenticated user, and insert/update/delete gated on is_admin().
--   Nothing here is case data and nothing is owner-scoped, so no RLS
--   invariant in docs/adr/ is touched. is_court_sitting_day() is SECURITY
--   INVOKER -- the table is readable by every authenticated user, so
--   there is nothing for DEFINER to add and no new privilege surface.
--   Audited like other reference tables so a changed court calendar is
--   attributable.

create table public.court_non_sitting_days (
  id uuid primary key default gen_random_uuid(),
  holiday_date date not null,
  name text not null,
  kind text not null check (kind in ('public_holiday', 'court_closure', 'sitting_exception')),
  court_id uuid references public.courts (id) on delete cascade,
  district_id uuid references public.magisterial_districts (id) on delete cascade,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  last_updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint court_non_sitting_days_one_scope check (court_id is null or district_id is null)
);

comment on table public.court_non_sitting_days is
  'Days a court does not sit: national, per magisterial district, or per court. Weekends are NOT stored here -- they are a rule in application code and in is_court_sitting_day(). kind = ''sitting_exception'' marks a day the court DOES sit that would otherwise be non-sitting (a special Saturday sitting), and beats every other rule. Advisory only: nothing blocks scheduling on one of these days, because a magistrate may lawfully sit on a holiday.';

comment on column public.court_non_sitting_days.district_id is
  'Applies to every court in this district. The district is passed to is_court_sitting_day() by the caller rather than resolved from public.courts: resolving it inside the function would silently return the wrong answer for anyone who cannot read that court row. Callers take it from the board row (courts.district_id), never docket_matters.district_id.';

-- One row per (date, name) per scope. Three partial indexes because NULL
-- scope columns would otherwise let duplicates through a plain unique.
create unique index court_non_sitting_days_national_idx
  on public.court_non_sitting_days (holiday_date, name)
  where court_id is null and district_id is null;

create unique index court_non_sitting_days_district_idx
  on public.court_non_sitting_days (holiday_date, name, district_id)
  where district_id is not null;

create unique index court_non_sitting_days_court_idx
  on public.court_non_sitting_days (holiday_date, name, court_id)
  where court_id is not null;

create index court_non_sitting_days_date_idx on public.court_non_sitting_days (holiday_date);

alter table public.court_non_sitting_days enable row level security;

create policy "Court non-sitting days are viewable by all authenticated users"
  on public.court_non_sitting_days for select
  using (true);

create policy "Admins manage court non-sitting days"
  on public.court_non_sitting_days for insert
  with check ((select public.is_admin()));

create policy "Admins update court non-sitting days"
  on public.court_non_sitting_days for update
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Admins delete court non-sitting days"
  on public.court_non_sitting_days for delete
  using ((select public.is_admin()));

create trigger set_court_non_sitting_days_updated_at
  before update on public.court_non_sitting_days
  for each row execute function public.set_updated_at();

create trigger audit_court_non_sitting_days
  after insert or update or delete on public.court_non_sitting_days
  for each row execute function public.audit_trigger_fn();

-- ----------------------------------------------------------------------------
-- is_court_sitting_day -- the single server-side answer, mirrored in
-- src/lib/court-calendar.ts. Two implementations of one rule is exactly
-- where drift happens, so a live-db test asserts they agree on a shared
-- fixture set.
-- ----------------------------------------------------------------------------

create or replace function public.is_court_sitting_day(
  p_date date,
  p_court_id uuid default null,
  p_district_id uuid default null
)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  with scoped as (
    select d.kind
    from public.court_non_sitting_days d
    where d.holiday_date = p_date
      and (
        (d.court_id is null and d.district_id is null)
        or (p_court_id is not null and d.court_id = p_court_id)
        or (p_district_id is not null and d.district_id = p_district_id)
      )
  )
  select case
    -- An explicit sitting exception beats the weekend rule and any
    -- holiday recorded for the same day.
    when exists (select 1 from scoped where kind = 'sitting_exception') then true
    when exists (select 1 from scoped) then false
    -- Saturday (6) and Sunday (7): a rule, never rows.
    when extract(isodow from p_date) >= 6 then false
    else true
  end;
$$;

comment on function public.is_court_sitting_day(date, uuid, uuid) is
  'Advisory: does this court sit on this date? Weekends are a rule; recorded non-sitting days are data; a sitting_exception beats both. SECURITY INVOKER -- court_non_sitting_days is readable by every authenticated user, so DEFINER would add nothing. The district is a PARAMETER rather than resolved from public.courts: resolving it here would silently return the wrong answer for any caller who cannot read that court row, which is a failure mode that looks like "the warning just stopped appearing". Deliberately NOT called by set_docket_matter_next_date: scheduling warns, it never blocks.';

grant execute on function public.is_court_sitting_day(date, uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Fixed-date national holidays, 2026 and 2027. Movable and religious
-- holidays are entered by an administrator -- see the header.
-- ----------------------------------------------------------------------------

insert into public.court_non_sitting_days (holiday_date, name, kind)
values
  ('2026-01-01', 'New Year''s Day', 'public_holiday'),
  ('2026-02-23', 'Republic Day (Mashramani)', 'public_holiday'),
  ('2026-05-01', 'Labour Day', 'public_holiday'),
  ('2026-05-05', 'Arrival Day', 'public_holiday'),
  ('2026-05-26', 'Independence Day', 'public_holiday'),
  ('2026-08-01', 'Emancipation Day', 'public_holiday'),
  ('2026-12-25', 'Christmas Day', 'public_holiday'),
  ('2026-12-26', 'Boxing Day', 'public_holiday'),
  ('2027-01-01', 'New Year''s Day', 'public_holiday'),
  ('2027-02-23', 'Republic Day (Mashramani)', 'public_holiday'),
  ('2027-05-01', 'Labour Day', 'public_holiday'),
  ('2027-05-05', 'Arrival Day', 'public_holiday'),
  ('2027-05-26', 'Independence Day', 'public_holiday'),
  ('2027-08-01', 'Emancipation Day', 'public_holiday'),
  ('2027-12-25', 'Christmas Day', 'public_holiday'),
  ('2027-12-26', 'Boxing Day', 'public_holiday')
on conflict do nothing;
