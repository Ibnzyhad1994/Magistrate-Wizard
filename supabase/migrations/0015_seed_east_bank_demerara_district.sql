-- Magistrate Wizard — seed East Bank Demerara Magisterial District
-- The eleventh Magisterial District, newly constituted since the ten
-- seeded in migration 0014. Added as its own forward migration rather
-- than rewriting the already-applied seed, per the project's
-- never-edit-applied-migrations rule.
--
-- Safe to re-run: magisterial_districts.name has a case-insensitive
-- unique index (magisterial_districts_name_idx, on lower(name)) from
-- migration 0013. ON CONFLICT (lower(name)) DO NOTHING means running
-- this again, or against a database that already has this row, inserts
-- nothing rather than erroring or duplicating.

insert into public.magisterial_districts (name)
values ('East Bank Demerara Magisterial District')
on conflict (lower(name)) do nothing;
