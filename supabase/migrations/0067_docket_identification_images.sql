-- Identification imagery for Docket: a matter cover (browse tile / billboard)
-- and a party identification photograph. Files live in the existing private
-- `documents` bucket so Storage SELECT continues to require a matching
-- `public.documents` metadata row (0011/0040). The path columns on
-- docket_matters / docket_matter_parties are denormalized for cheap list
-- rendering; they do not grant access on their own — parent-table RLS still
-- decides who can see or change them.
--
-- `documents.purpose` distinguishes ordinary attachments from cover and
-- identification photos so the Documents panel can hide ID photos (those
-- are managed on the party) without inventing a new entity_type.

alter table public.documents
  add column purpose text not null default 'attachment';

alter table public.documents
  add constraint documents_purpose_check
    check (purpose in ('attachment', 'cover', 'identification_photo'));

comment on column public.documents.purpose is
  'attachment = ordinary file on the parent; cover = Docket Matter browse/billboard image; identification_photo = party photograph. All three still follow the parent''s documents RLS.';

alter table public.docket_matters
  add column cover_image_path text;

comment on column public.docket_matters.cover_image_path is
  'Storage object name in the documents bucket used as the matter cover. Must correspond to a public.documents row so Storage RLS can mint a signed URL. Cleared independently of the documents row (ON DELETE is not declarative here).';

alter table public.docket_matter_parties
  add column identification_photo_path text;

comment on column public.docket_matter_parties.identification_photo_path is
  'Storage object name in the documents bucket for this party''s identification photograph. Visible to callers who can already SELECT the parent Docket Matter. contact_info remains dialog-only; this photo is intentionally shown on the party list and may be reused as the matter cover.';

-- Search must return the cover path so filtered Docket lists can still
-- render identification imagery without a second round-trip. charge_or_issue
-- is included so search tiles can show the charge on the cover.
-- DROP first: CREATE OR REPLACE cannot widen a RETURNS TABLE shape.
drop function if exists public.search_docket_matters(text, integer);

create function public.search_docket_matters(p_query text, p_limit integer default 20)
returns table (
  id uuid,
  case_number text,
  matter_title text,
  status docket_matter_status,
  rank real,
  headline text,
  cover_image_path text,
  charge_or_issue text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    dm.id, dm.case_number, dm.matter_title, dm.status,
    ts_rank(dm.search_vector, websearch_to_tsquery('english', p_query)) as rank,
    ts_headline('english', coalesce(dm.orders_summary, dm.charge_or_issue, ''),
      websearch_to_tsquery('english', p_query),
      'MaxFragments=2, MaxWords=30, MinWords=10') as headline,
    dm.cover_image_path,
    dm.charge_or_issue
  from public.docket_matters dm
  where dm.search_vector @@ websearch_to_tsquery('english', p_query)
  order by rank desc
  limit p_limit;
$$;

grant execute on function public.search_docket_matters(text, integer) to authenticated;

comment on function public.search_docket_matters(text, integer) is
  'Full-text search over docket_matters. SECURITY INVOKER -- relies entirely on docket_matters'' own SELECT RLS. Returns cover_image_path and charge_or_issue so browse tiles can render identification imagery and charge text without a second query.';
