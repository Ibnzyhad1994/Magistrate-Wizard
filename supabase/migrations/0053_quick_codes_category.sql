-- Additive only: lightweight optional category/folder for personal Quick Codes.
-- No RLS change required: existing owner-only row-level policies on quick_codes
-- already govern every column, including this new one.
alter table public.quick_codes
  add column category text;

comment on column public.quick_codes.category is
  'Optional lightweight grouping label chosen by the owner (e.g. Adjournments, Bail, Sentencing). Free text, not a controlled taxonomy.';
