-- BenchBook — reconcile Guyana Magistrates' Courts to verified operational structure
-- Migration 0018 seeded 46 Court rows from an earlier researched/inferred list.
-- That list has since been superseded by a personally verified current
-- operational Court/District structure from within the Guyana Magistracy.
-- 0018 is already applied and is NOT edited here (applied migrations are
-- immutable in this project) — this is a forward reconciliation migration
-- that transitions the live courts table from the 46-row 0018 state to the
-- verified 55-row target state.
--
-- Live-state inspection performed immediately before this migration was
-- written confirmed:
--   - none of the 46 courts seeded by 0018 are referenced by
--     magistrate_courts (0 rows total in that table);
--   - none are referenced by cases (0 rows total in that table);
--   - none are referenced by profiles;
--   - the only referenced court in the whole table is
--     'General Magistrate Court' (1 profiles row), which this migration
--     does not touch at all.
--
-- Because that inspection happened in a prior step and real time has
-- passed before this migration is applied, section 1 below re-verifies
-- the specific preconditions this migration depends on and fails loudly
-- (RAISE EXCEPTION, aborting the whole migration) rather than silently
-- proceeding if live state has drifted from what was inspected.
--
-- Reconciliation actions (per the approved plan):
--   RENAME (existing row, same court, corrected name — UUID preserved):
--     - Diamond/Golden Grove Magistrates' Court 2  -> ... Court 3
--     - New Amsterdam Magistrate's Court 1         -> New Amsterdam Magistrate's Court
--     - Leonora Magistrate's Court                 -> Leonora Magistrates' Court 1
--   DELETE (unreferenced row resulting from the incorrect 0018 structure,
--   not a legitimate dormant court — unlike Vigilance Court 2, so
--   deactivating it would misrepresent the verified structure):
--     - New Amsterdam Magistrate's Court 2
--   ADD (genuinely new operational units per the verified structure):
--     - Georgetown Magistrates' Court 8, 9, 10
--     - Albion Magistrate's Court
--     - Leonora Magistrates' Court 2
--     - West Demerara Children's Court
--     - Bartica Magistrate's Court
--     - Mahdia Magistrate's Court
--     - Kamarang Magistrate's Court
--     - Acquero Magistrate's Court
--   UNCHANGED: every other court from 0018 (42 rows), including both
--   Vigilance Magistrates' Court 1 (active) and Court 2 (inactive), and
--   the 'General Magistrate Court' placeholder (untouched entirely).
--
-- All renames only change `name` — `district_id` does not change for any
-- renamed row, so `jurisdiction` (which mirrors the resolved district
-- name, per the convention established in 0018) remains correct without
-- modification.
--
-- New rows resolve district_id by joining on magisterial_districts.name,
-- exactly as in 0018 — no hard-coded district UUIDs.
--
-- Idempotency note: this migration is a one-time state transition, not a
-- repeatable seed like 0018. The ADD section is independently idempotent
-- (ON CONFLICT ... DO NOTHING, matching 0018's convention). The RENAME
-- and DELETE sections are deliberately NOT designed to no-op safely on a
-- second run: if 0019 has already been applied, the old names
-- ('Diamond/Golden Grove Magistrates' Court 2', 'New Amsterdam
-- Magistrate's Court 1', 'New Amsterdam Magistrate's Court 2', 'Leonora
-- Magistrate's Court') no longer exist, so the precondition checks in
-- section 1 will correctly fail the whole migration rather than silently
-- doing nothing or, worse, matching some other row. This is intentional:
-- a state-transition migration should refuse to run against a database
-- that isn't in the exact prior state it expects.

-- 1. Precondition / drift-safety checks --------------------------------------
-- Verifies the exact live state this migration depends on before making
-- any change. Aborts the entire migration (nothing below runs) if any
-- assumption no longer holds.

do $$
declare
  v_diamond2_id uuid;
  v_na1_id uuid;
  v_na2_id uuid;
  v_leonora_id uuid;
  v_refs_magistrate_courts int;
  v_refs_cases int;
  v_refs_profiles int;
begin
  -- 1a. Rows expected to be renamed/deleted must exist, in the expected
  -- district, under the expected exact current name.
  select c.id into v_diamond2_id
  from public.courts c
  join public.magisterial_districts d on d.id = c.district_id
  where c.name = 'Diamond/Golden Grove Magistrates'' Court 2'
    and d.name = 'East Bank Demerara Magisterial District';

  if v_diamond2_id is null then
    raise exception '0019 precondition failed: "Diamond/Golden Grove Magistrates'' Court 2" not found in East Bank Demerara Magisterial District as expected — live state has drifted, aborting.';
  end if;

  select c.id into v_na1_id
  from public.courts c
  join public.magisterial_districts d on d.id = c.district_id
  where c.name = 'New Amsterdam Magistrate''s Court 1'
    and d.name = 'Berbice Magisterial District';

  if v_na1_id is null then
    raise exception '0019 precondition failed: "New Amsterdam Magistrate''s Court 1" not found in Berbice Magisterial District as expected — live state has drifted, aborting.';
  end if;

  select c.id into v_na2_id
  from public.courts c
  join public.magisterial_districts d on d.id = c.district_id
  where c.name = 'New Amsterdam Magistrate''s Court 2'
    and d.name = 'Berbice Magisterial District';

  if v_na2_id is null then
    raise exception '0019 precondition failed: "New Amsterdam Magistrate''s Court 2" not found in Berbice Magisterial District as expected — live state has drifted, aborting.';
  end if;

  select c.id into v_leonora_id
  from public.courts c
  join public.magisterial_districts d on d.id = c.district_id
  where c.name = 'Leonora Magistrate''s Court'
    and d.name = 'West Demerara Magisterial District';

  if v_leonora_id is null then
    raise exception '0019 precondition failed: "Leonora Magistrate''s Court" not found in West Demerara Magisterial District as expected — live state has drifted, aborting.';
  end if;

  -- 1b. Target names must not already exist (would otherwise collide with
  -- the renames/inserts below under the existing (name, jurisdiction)
  -- uniqueness mechanism).
  if exists (select 1 from public.courts where name = 'Diamond/Golden Grove Magistrates'' Court 3') then
    raise exception '0019 precondition failed: "Diamond/Golden Grove Magistrates'' Court 3" already exists — refusing to proceed with rename.';
  end if;

  if exists (select 1 from public.courts where name = 'New Amsterdam Magistrate''s Court') then
    raise exception '0019 precondition failed: "New Amsterdam Magistrate''s Court" already exists — refusing to proceed with rename.';
  end if;

  if exists (select 1 from public.courts where name = 'Leonora Magistrates'' Court 1') then
    raise exception '0019 precondition failed: "Leonora Magistrates'' Court 1" already exists — refusing to proceed with rename.';
  end if;

  if exists (select 1 from public.courts where name = 'Leonora Magistrates'' Court 2') then
    raise exception '0019 precondition failed: "Leonora Magistrates'' Court 2" already exists — refusing to proceed with insert.';
  end if;

  -- 1c. Every row being structurally reinterpreted (the 3 renames AND the
  -- 1 delete) must remain completely unreferenced right up to the point
  -- of change — re-verified here, not just trusted from the earlier
  -- inspection step. This applies to the renames too, not only the
  -- delete: although preserving a UUID means an ordinary rename would not
  -- break any FK technically, these particular renames change the
  -- operational identity the row represents (e.g. Diamond Court 2 becoming
  -- Court 3). If a magistrate_courts, cases, or profiles row had been
  -- created against one of these courts since the inspection, silently
  -- renaming it would incorrectly reassociate that reference with a
  -- different operational court. Each check aborts the whole migration on
  -- any reference found, rather than proceeding.

  select count(*) into v_refs_magistrate_courts
  from public.magistrate_courts where court_id = v_diamond2_id;
  select count(*) into v_refs_cases
  from public.cases where court_id = v_diamond2_id;
  select count(*) into v_refs_profiles
  from public.profiles where court_id = v_diamond2_id;
  if v_refs_magistrate_courts > 0 or v_refs_cases > 0 or v_refs_profiles > 0 then
    raise exception '0019 precondition failed: "Diamond/Golden Grove Magistrates'' Court 2" (id %) has acquired % magistrate_courts, % cases, and % profiles reference(s) since it was inspected as unreferenced — refusing to rename a now-referenced row.',
      v_diamond2_id, v_refs_magistrate_courts, v_refs_cases, v_refs_profiles;
  end if;

  select count(*) into v_refs_magistrate_courts
  from public.magistrate_courts where court_id = v_na1_id;
  select count(*) into v_refs_cases
  from public.cases where court_id = v_na1_id;
  select count(*) into v_refs_profiles
  from public.profiles where court_id = v_na1_id;
  if v_refs_magistrate_courts > 0 or v_refs_cases > 0 or v_refs_profiles > 0 then
    raise exception '0019 precondition failed: "New Amsterdam Magistrate''s Court 1" (id %) has acquired % magistrate_courts, % cases, and % profiles reference(s) since it was inspected as unreferenced — refusing to rename a now-referenced row.',
      v_na1_id, v_refs_magistrate_courts, v_refs_cases, v_refs_profiles;
  end if;

  select count(*) into v_refs_magistrate_courts
  from public.magistrate_courts where court_id = v_leonora_id;
  select count(*) into v_refs_cases
  from public.cases where court_id = v_leonora_id;
  select count(*) into v_refs_profiles
  from public.profiles where court_id = v_leonora_id;
  if v_refs_magistrate_courts > 0 or v_refs_cases > 0 or v_refs_profiles > 0 then
    raise exception '0019 precondition failed: "Leonora Magistrate''s Court" (id %) has acquired % magistrate_courts, % cases, and % profiles reference(s) since it was inspected as unreferenced — refusing to rename a now-referenced row.',
      v_leonora_id, v_refs_magistrate_courts, v_refs_cases, v_refs_profiles;
  end if;

  select count(*) into v_refs_magistrate_courts
  from public.magistrate_courts where court_id = v_na2_id;
  select count(*) into v_refs_cases
  from public.cases where court_id = v_na2_id;
  select count(*) into v_refs_profiles
  from public.profiles where court_id = v_na2_id;
  if v_refs_magistrate_courts > 0 or v_refs_cases > 0 or v_refs_profiles > 0 then
    raise exception '0019 precondition failed: "New Amsterdam Magistrate''s Court 2" (id %) has acquired % magistrate_courts, % cases, and % profiles reference(s) since it was inspected as unreferenced — refusing to delete a now-referenced row.',
      v_na2_id, v_refs_magistrate_courts, v_refs_cases, v_refs_profiles;
  end if;

  -- 1d. General Magistrate Court must exist untouched and is never
  -- targeted by any statement below — sanity check only, not a guard on
  -- any action.
  if not exists (select 1 from public.courts where name = 'General Magistrate Court') then
    raise exception '0019 precondition failed: "General Magistrate Court" placeholder is missing — aborting as a general sanity check.';
  end if;
end $$;

-- 2. Renames (existing rows, UUIDs preserved) ---------------------------------
-- Matched by exact current name AND resolved district, so this cannot
-- accidentally match a similarly named row in a different district.

update public.courts c
set name = 'Diamond/Golden Grove Magistrates'' Court 3'
from public.magisterial_districts d
where c.district_id = d.id
  and c.name = 'Diamond/Golden Grove Magistrates'' Court 2'
  and d.name = 'East Bank Demerara Magisterial District';

update public.courts c
set name = 'New Amsterdam Magistrate''s Court'
from public.magisterial_districts d
where c.district_id = d.id
  and c.name = 'New Amsterdam Magistrate''s Court 1'
  and d.name = 'Berbice Magisterial District';

update public.courts c
set name = 'Leonora Magistrates'' Court 1'
from public.magisterial_districts d
where c.district_id = d.id
  and c.name = 'Leonora Magistrate''s Court'
  and d.name = 'West Demerara Magisterial District';

-- 3. Delete (unreferenced row resulting from the incorrect 0018 structure) ----
-- Re-checked as unreferenced immediately above in section 1c. Matched by
-- exact name AND resolved district, same precision as the renames.

delete from public.courts c
using public.magisterial_districts d
where c.district_id = d.id
  and c.name = 'New Amsterdam Magistrate''s Court 2'
  and d.name = 'Berbice Magisterial District';

-- 4. Adds (genuinely new operational units) -----------------------------------
-- Same pattern as 0018: district_id resolved by joining on
-- magisterial_districts.name, no hard-coded UUIDs; ON CONFLICT (name,
-- jurisdiction) DO NOTHING for idempotency on this section specifically.

insert into public.courts (name, jurisdiction, district_id, is_active)
select v.court_name, d.name, d.id, true
from (
  values
    ('Georgetown Magistrates'' Court 8', 'Georgetown Magisterial District'),
    ('Georgetown Magistrates'' Court 9', 'Georgetown Magisterial District'),
    ('Georgetown Magistrates'' Court 10', 'Georgetown Magisterial District'),
    ('Albion Magistrate''s Court', 'Berbice Magisterial District'),
    ('Leonora Magistrates'' Court 2', 'West Demerara Magisterial District'),
    ('West Demerara Children''s Court', 'West Demerara Magisterial District'),
    ('Bartica Magistrate''s Court', 'Essequibo Magisterial District'),
    ('Mahdia Magistrate''s Court', 'Essequibo Magisterial District'),
    ('Kamarang Magistrate''s Court', 'Essequibo Magisterial District'),
    ('Acquero Magistrate''s Court', 'North West Magisterial District')
) as v(court_name, district_name)
join public.magisterial_districts d on d.name = v.district_name
on conflict (name, jurisdiction) do nothing;
