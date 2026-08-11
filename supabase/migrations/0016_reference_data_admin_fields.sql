-- BenchBook — reference-data administrative fields
-- Adds the columns needed for BenchBook to eventually manage Magisterial
-- Districts and Courts entirely through an admin interface, without a
-- further SQL migration every time the Judiciary creates a new district
-- or opens/renames/closes/reactivates a court.
--
-- magisterial_districts.is_active could not be added to the
-- already-applied 0013 migration (applied migrations are never edited
-- in this project) — it arrives here instead.
--
-- courts.district_id links each court to its Magisterial District.
-- Nullable: a court may legitimately exist before its district is
-- assigned (the current "General Magistrate Court" row, for example,
-- will have district_id = NULL after this migration until an admin
-- assigns it). The rule "a Docket Matter may not be created against a
-- court with no district" is NOT enforced here — it belongs on
-- docket_matters (a later migration), since that's where it's actually
-- needed and where the relevant trigger has something to check.
--
-- courts.is_active follows the same pattern as magisterial_districts:
-- governs whether a court is normally offered for new magistrate
-- assignments and new Docket entry. It is NOT a historical-access
-- control and must never be used as an RLS gate for existing Docket
-- data — see the architecture specification's RLS model.
--
-- Note on the district-change-immutability safeguard: the previously
-- approved rule ("once a court is referenced by a Docket Matter, its
-- district_id may not be casually changed") is intentionally NOT
-- implemented in this migration. It requires a trigger that checks the
-- docket_matters table, which does not exist yet at this point in the
-- migration sequence — that trigger will be added once docket_matters
-- exists. This creates no interim gap: no docket_matters rows can exist
-- before that table does, so there is nothing to protect yet.

-- 1. magisterial_districts: is_active ---------------------------------------

alter table public.magisterial_districts
  add column is_active boolean not null default true;

comment on column public.magisterial_districts.is_active is 'Governs whether this district is normally offered for new court assignments and new Docket entry. Not a historical-access control — existing references remain valid regardless of this flag.';

create index magisterial_districts_is_active_idx on public.magisterial_districts (is_active);

-- 2. courts: district_id + is_active -----------------------------------------

alter table public.courts
  add column district_id uuid references public.magisterial_districts (id) on delete restrict,
  add column is_active boolean not null default true;

comment on column public.courts.district_id is 'The Magisterial District this court belongs to. Nullable: a court may be created before its district is assigned. A Docket Matter may not be created against a court with a null district_id — enforced by a trigger on docket_matters in a later migration, not here.';
comment on column public.courts.is_active is 'Governs whether this court is normally offered for new magistrate assignments and new Docket entry. Not a historical-access control — do not use this as an RLS gate for existing Docket access; ending an individual magistrate''s access always goes through ending their magistrate_courts assignment, never through this flag.';

create index courts_district_id_idx on public.courts (district_id);
create index courts_is_active_idx on public.courts (is_active);
