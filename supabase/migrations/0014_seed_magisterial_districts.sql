-- Magistrate Wizard — seed magisterial districts
-- Inserts Guyana's ten Magisterial Districts, per the Supreme Court of
-- Judicature's Annual Reports. Only the official name is stored — the
-- current magisterial_districts schema (0013) has no head-office/
-- administrative-location column, and none is being added here; that
-- information is contextual only for now.
--
-- Safe to re-run: magisterial_districts.name has a case-insensitive
-- unique index (magisterial_districts_name_idx, on lower(name)) from
-- migration 0013. ON CONFLICT (lower(name)) DO NOTHING means running
-- this migration again, or against a database that already has some of
-- these rows, inserts only what's missing rather than erroring or
-- duplicating.

insert into public.magisterial_districts (name)
values
  ('Georgetown Magisterial District'),
  ('Corentyne Magisterial District'),
  ('Berbice Magisterial District'),
  ('East Demerara Magisterial District'),
  ('West Demerara Magisterial District'),
  ('Essequibo Magisterial District'),
  ('North West Magisterial District'),
  ('Rupununi Magisterial District'),
  ('West Berbice Magisterial District'),
  ('Upper Demerara River Magisterial District')
on conflict (lower(name)) do nothing;
