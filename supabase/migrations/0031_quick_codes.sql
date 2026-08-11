-- 0031_quick_codes.sql
--
-- Individually owned Quick Code records -- personal, reusable text-
-- expansion/snippets (e.g. conceptually "bail1" -> reusable bail-
-- condition wording, "adj30" -> reusable adjournment wording;
-- illustrative only, nothing is seeded). Personal productivity tooling,
-- NOT a Judgment, Case Law, a Docket Matter/Event, a Court-wide
-- institutional template, a discoverable/public legal resource, or a
-- shared administrative record. A Quick Code belongs to exactly one
-- owner.
--
-- This is the simplest, most fully private access model built in this
-- project so far: SELECT/INSERT/UPDATE/DELETE are ALL owner-only, with
-- no exceptions whatsoever. can_access_court(), has_retained_
-- assignment(), is_discoverable, and is_admin() are never referenced
-- anywhere in this migration -- there is no Court/Docket relationship,
-- no discoverable pool, and no admin bypass. The real Admin profile
-- must behave exactly like any other non-owner when attempting to
-- access someone else's Quick Codes.
--
-- Deliberate difference from every join/tag table built so far (0026,
-- 0028, 0029, 0030): a Quick Code has an UPDATE policy. It is a genuine
-- standalone personal record with editable substantive fields
-- (code_word, title, content, description), not an association or a
-- lifecycle-locked tag -- only owner_id is immutable.
--
-- Owner hard DELETE is approved, with no archive status, no
-- entered_in_error, no ended_at, no lifecycle ledger -- Quick Codes are
-- personal productivity data, not judicial-history records.
--
-- code_word uniqueness is case-insensitive/whitespace-trimmed and
-- scoped PER OWNER only, never global -- different owners may freely
-- reuse the same code word; the same owner cannot have both "Bail1" and
-- "bail1".
--
-- content is plain text only in this foundational migration -- no
-- JSONB/rich-text/editor schema yet. NOT NULL and must not be blank
-- after trimming; the substantive value itself is never auto-rewritten,
-- only validated (title/description/content are never reformatted by
-- the guard trigger, only code_word is trimmed for storage).
--
-- No search_vector, no full-text index, and no global_search()
-- integration are added here -- that remains the responsibility of the
-- later, dedicated 0044_search_extensions migration (current numbering,
-- confirmed unchanged as of 0031). Quick Code lookup in this migration
-- is supported only by owner filtering and the per-owner unique index
-- on code_word.
--
-- The future quick_code_docket_matters / quick_code_judgments /
-- quick_code_case_law join tables are explicitly NOT created here. A
-- Quick Code must be able to exist independently of all of them.
-- Future-association principle, recorded now: linking a Quick Code to
-- any other entity must never itself grant access to the Quick Code --
-- its own strict owner-only RLS remains the sole gate regardless of
-- what it is later linked to.
--
-- No shares path exists in 0031. If Quick Code sharing is ever
-- introduced, it requires an explicit future design decision.

create table public.quick_codes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  code_word text not null,
  title text,
  content text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quick_codes_code_word_not_blank check (btrim(code_word) <> ''),
  constraint quick_codes_content_not_blank check (btrim(content) <> '')
);

comment on table public.quick_codes is
  'Individually owned Quick Code records -- private, reusable text-expansion/snippets. Personal productivity tooling, never Court/Docket-related, never discoverable, never admin-accessible. SELECT/INSERT/UPDATE/DELETE are all owner-only with no exceptions. code_word uniqueness is case-insensitive/whitespace-trimmed and scoped per owner, never global. Owner hard DELETE is approved (personal productivity data, not judicial history). No quick_code_docket_matters/quick_code_judgments/quick_code_case_law join tables are created here -- a Quick Code must exist independently of all of them, and any future link must never itself grant access to the Quick Code.';
comment on column public.quick_codes.owner_id is
  'Forced to auth.uid() at creation by a guard trigger (cannot be forged) and immutable thereafter -- an owner cannot transfer a Quick Code to another profile by UPDATE, mirroring the judgments.owner_id pattern from 0027. ON DELETE RESTRICT makes a Quick-Code-owning profile impossible to hard-delete. Quick Codes never transfer to a successor magistrate merely because that successor takes over the former owner''s Court -- there is no Court/Docket relationship here at all.';
comment on column public.quick_codes.code_word is
  'Short shorthand/token the owner uses to identify/invoke the snippet (e.g. "bail1"). Must not be blank after trimming (CHECK). Trimmed before storage; entered/display casing preserved. Case-insensitive, whitespace-trimmed uniqueness is enforced PER OWNER only (see quick_codes_owner_code_word_unique_idx) -- the same code word used by a different owner is explicitly not a duplicate. No restrictive character grammar is imposed in this migration.';
comment on column public.quick_codes.title is
  'Optional human-readable name for browsing (e.g. "Standard bail conditions"). Not required -- some owners may identify snippets by code_word alone.';
comment on column public.quick_codes.content is
  'The reusable expanded text itself. Plain text only in this foundational migration -- no JSONB/rich-text/editor schema yet. Must not be blank after trimming (CHECK). Never auto-rewritten/reformatted by the guard trigger -- only validated.';
comment on column public.quick_codes.description is
  'Optional owner-facing explanation of what the Quick Code is for. Distinct from content -- never treated as the expansion text itself.';

-- Forces owner_id to the authenticated user at creation (defense in
-- depth alongside the DEFAULT and the RLS WITH CHECK below), rejects
-- any attempt to change owner_id on UPDATE (ownership is immutable
-- after creation, mirroring judgments_guard() from 0027), and
-- normalizes stored code_word by trimming leading/trailing whitespace
-- on both INSERT and UPDATE (casing is left exactly as entered).
-- title/content/description are never rewritten here -- content in
-- particular must reach storage exactly as the owner wrote it, subject
-- only to the not-blank CHECK constraint.
create or replace function public.quick_codes_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.owner_id := (select auth.uid());
    new.code_word := btrim(new.code_word);
  elsif tg_op = 'UPDATE' then
    if new.owner_id is distinct from old.owner_id then
      raise exception 'A Quick Code''s owner_id is immutable; ownership cannot be transferred by UPDATE.';
    end if;
    new.code_word := btrim(new.code_word);
  end if;
  return new;
end;
$$;

create trigger quick_codes_guard_trigger
  before insert or update on public.quick_codes
  for each row execute function public.quick_codes_guard();

create trigger set_quick_codes_updated_at
  before update on public.quick_codes
  for each row execute function public.set_updated_at();

-- Case-insensitive, whitespace-trimmed duplicate prevention, scoped to
-- the individual owner only -- "Bail1" and "bail1" cannot coexist for
-- the same owner; different owners may independently use the identical
-- code_word. owner_id is the LEADING column, so this same index also
-- efficiently serves plain "all of my Quick Codes" / owner-scoped RLS
-- lookups and the owner_id foreign key -- a separate plain index on
-- owner_id alone would therefore be redundant and is deliberately not
-- added (same reasoning already applied to docket_matter_tags and
-- judgment_tags in 0026/0028).
create unique index quick_codes_owner_code_word_unique_idx
  on public.quick_codes (owner_id, lower(btrim(code_word)));

alter table public.quick_codes enable row level security;

create policy "Owners can view their Quick Codes"
  on public.quick_codes for select
  using (owner_id = (select auth.uid()));

create policy "Owners can create Quick Codes"
  on public.quick_codes for insert
  with check (owner_id = (select auth.uid()));

create policy "Owners can update their Quick Codes"
  on public.quick_codes for update
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "Owners can delete their Quick Codes"
  on public.quick_codes for delete
  using (owner_id = (select auth.uid()));

-- No admin bypass, anywhere on this table -- the real Admin profile
-- must satisfy owner_id = auth.uid() like anyone else, and has zero
-- special access to another magistrate's Quick Codes.
--
-- No Court/Docket access rule is referenced anywhere -- Quick Codes are
-- fully independent of the Court-Anchored Docket, exactly like
-- judgments (0027).
--
-- No is_discoverable concept exists on this table -- unlike judgments,
-- there is no read-only visibility extension to other magistrates at
-- all in 0031.
--
-- Not yet the shares path: no shares logic is implemented here. If
-- Quick Code sharing is ever introduced, it requires an explicit future
-- design decision, exactly as recorded for judgments/
-- docket_matter_judgments.
--
-- Explicitly NOT built in 0031: quick_code_docket_matters,
-- quick_code_judgments, quick_code_case_law (a Quick Code must be able
-- to exist independently of all of them), search_vector/full-text
-- search/global_search() integration (deferred to
-- 0044_search_extensions), and any character-grammar restriction on
-- code_word beyond non-blank-after-trim.
