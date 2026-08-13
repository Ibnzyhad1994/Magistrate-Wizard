-- Magistrate Wizard — seed Guyana Magistrates' Courts (operational units)
-- Seeds the verified, researched list of Guyana's operational
-- Magistrates' Courts, each linked to its Magisterial District.
--
-- OPERATIONAL-UNIT PRINCIPLE (per the approved correction to the
-- Court-seeding architecture): a courts row represents the smallest
-- operational Magistrates' Court unit with its own sitting magistrate
-- and its own Docket/access boundary — NOT a physical courthouse.
-- Where one courthouse hosts multiple separately-sitting courts (e.g.
-- Georgetown's numbered courts, Sparendaam 1/2, Diamond/Golden Grove
-- 1/2, New Amsterdam 1/2), each is its own row here, sharing only the
-- Magisterial District (and, informally, the building) with its
-- siblings. magistrate_courts and Docket access are both scoped by
-- court_id, so collapsing separately-sitting courts into one row would
-- incorrectly merge their access boundaries.
--
-- Deliberately NOT seeded, per your explicit instruction:
--   - Georgetown Magistrates' Courts 4, 8, 9, 10, 12 — not inferred
--     merely to fill the numeric sequence; not sufficiently verified
--     as current separate operational units.
--   - Bartica, Kamarang, Mahdia — confirmed courts, but their formal
--     Magisterial District relationship is not yet sufficiently
--     established for a safe district_id; do not infer from
--     administrative Region numbers.
--   - Parika — older material places it in West Demerara, but its
--     current operational status requires separate verification first.
--
-- district_id is resolved by joining on magisterial_districts.name —
-- no UUID is hard-coded anywhere in this file. Every district name
-- below is the exact string seeded in migrations 0014/0015.
--
-- courts.jurisdiction remains NOT NULL and is still, as documented
-- since migration 0016, a legacy/free-text column superseded by
-- district_id and unused by new functionality going forward. It is
-- populated here with the resolved district's name purely to satisfy
-- the NOT NULL constraint with something more meaningful than a
-- placeholder string — it plays no role in access control or
-- district resolution, both of which come from district_id.
--
-- Idempotent: ON CONFLICT (name, jurisdiction) DO NOTHING targets the
-- existing courts_name_jurisdiction_idx unique index from migration
-- 0002 — see the review notes for why this is sufficient here and what
-- should change about that constraint later.
--
-- is_active is specified explicitly per row rather than defaulted to
-- true for every seeded court. A courts row records a legitimate,
-- structurally distinct operational Court unit; it does not assert
-- that the unit is presently staffed. is_active = false preserves such
-- a unit in the reference dataset (available to be reactivated later
-- by an admin via a simple UPDATE, with no new migration required)
-- while excluding it from normal current-assignment/current-Docket
-- workflows. Vigilance Magistrates' Court 2 is seeded this way below:
-- it is an established, separately-sitting Court unit distinct from
-- Vigilance Magistrates' Court 1, but is not presently operational.
--
-- Does not touch the existing "General Magistrate Court" placeholder
-- row, create any magistrate_courts assignments, or create any
-- docket_matters (that table does not exist yet).
--
-- Fresh local databases (unlike the original hosted project) do not
-- already have that placeholder. 0019 aborts unless it exists, so seed
-- it here when missing. Production already has the row; ON CONFLICT
-- keeps this statement a no-op there if 0018 were ever replayed.

insert into public.courts (name, jurisdiction, is_active)
values ('General Magistrate Court', 'Placeholder', true)
on conflict (name, jurisdiction) do nothing;

insert into public.courts (name, jurisdiction, district_id, is_active)
select v.court_name, d.name, d.id, v.is_active
from (
  values
    -- Georgetown Magisterial District (8)
    ('Georgetown Magistrates'' Court 1', 'Georgetown Magisterial District', true),
    ('Georgetown Magistrates'' Court 2', 'Georgetown Magisterial District', true),
    ('Georgetown Magistrates'' Court 3', 'Georgetown Magisterial District', true),
    ('Georgetown Magistrates'' Court 5', 'Georgetown Magisterial District', true),
    ('Georgetown Magistrates'' Court 6', 'Georgetown Magisterial District', true),
    ('Georgetown Magistrates'' Court 7', 'Georgetown Magisterial District', true),
    ('Georgetown Magistrates'' Court 11', 'Georgetown Magisterial District', true),
    ('Georgetown Children''s Court', 'Georgetown Magisterial District', true),

    -- East Bank Demerara Magisterial District (3)
    ('Diamond/Golden Grove Magistrates'' Court 1', 'East Bank Demerara Magisterial District', true),
    ('Diamond/Golden Grove Magistrates'' Court 2', 'East Bank Demerara Magisterial District', true),
    ('Friendship Magistrate''s Court', 'East Bank Demerara Magisterial District', true),

    -- East Demerara Magisterial District (7)
    ('Sparendaam Magistrates'' Court 1', 'East Demerara Magisterial District', true),
    ('Sparendaam Magistrates'' Court 2', 'East Demerara Magisterial District', true),
    ('Vigilance Magistrates'' Court 1', 'East Demerara Magisterial District', true),
    ('Vigilance Magistrates'' Court 2', 'East Demerara Magisterial District', false),
    ('Cove and John Magistrate''s Court', 'East Demerara Magisterial District', true),
    ('Mahaica Magistrate''s Court', 'East Demerara Magisterial District', true),
    ('Mahaicony Magistrate''s Court', 'East Demerara Magisterial District', true),

    -- West Demerara Magisterial District (3)
    ('Vreed-en-Hoop Magistrate''s Court', 'West Demerara Magisterial District', true),
    ('Leonora Magistrate''s Court', 'West Demerara Magisterial District', true),
    ('Wales Magistrate''s Court', 'West Demerara Magisterial District', true),

    -- West Berbice Magisterial District (3)
    ('Weldaad Magistrate''s Court', 'West Berbice Magisterial District', true),
    ('Fort Wellington Magistrate''s Court', 'West Berbice Magisterial District', true),
    ('Blairmont Magistrate''s Court', 'West Berbice Magisterial District', true),

    -- Berbice Magisterial District (4)
    ('New Amsterdam Magistrate''s Court 1', 'Berbice Magisterial District', true),
    ('New Amsterdam Magistrate''s Court 2', 'Berbice Magisterial District', true),
    ('Reliance Magistrate''s Court', 'Berbice Magisterial District', true),
    ('Sisters Magistrate''s Court', 'Berbice Magisterial District', true),

    -- Corentyne Magisterial District (4)
    ('Whim Magistrate''s Court', 'Corentyne Magisterial District', true),
    ('Mibicuri Magistrate''s Court', 'Corentyne Magisterial District', true),
    ('No. 51 Magistrate''s Court', 'Corentyne Magisterial District', true),
    ('Springlands Magistrate''s Court', 'Corentyne Magisterial District', true),

    -- Essequibo Magisterial District (5)
    ('Suddie Magistrate''s Court', 'Essequibo Magisterial District', true),
    ('Anna Regina Magistrate''s Court', 'Essequibo Magisterial District', true),
    ('Charity Magistrate''s Court', 'Essequibo Magisterial District', true),
    ('Wakenaam Magistrate''s Court', 'Essequibo Magisterial District', true),
    ('Leguan Magistrate''s Court', 'Essequibo Magisterial District', true),

    -- North West Magisterial District (3)
    ('Mabaruma Magistrate''s Court', 'North West Magisterial District', true),
    ('Port Kaituma Magistrate''s Court', 'North West Magisterial District', true),
    ('Matthews Ridge Magistrate''s Court', 'North West Magisterial District', true),

    -- Rupununi Magisterial District (4)
    ('Lethem Magistrate''s Court', 'Rupununi Magisterial District', true),
    ('Annai Magistrate''s Court', 'Rupununi Magisterial District', true),
    ('Aishalton Magistrate''s Court', 'Rupununi Magisterial District', true),
    ('Karasabai Magistrate''s Court', 'Rupununi Magisterial District', true),

    -- Upper Demerara River Magisterial District (2)
    ('Linden Magistrate''s Court', 'Upper Demerara River Magisterial District', true),
    ('Kwakwani Magistrate''s Court', 'Upper Demerara River Magisterial District', true)
) as v(court_name, district_name, is_active)
join public.magisterial_districts d on d.name = v.district_name
on conflict (name, jurisdiction) do nothing;
