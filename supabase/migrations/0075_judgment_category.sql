-- ============================================================================
-- 0075_judgment_category.sql
--
-- Adds a Category to `judgments`, reusing the same `legal_case_categories`
-- catalogue Case Law already classifies against (0073) -- one shared
-- "what type of matter is this" vocabulary across the app, rather than a
-- second parallel one. Directly answers "what offence does this judgment
-- concern" in the Judgment detail page's general details, alongside an
-- automatic tag proposal run over the judgment's own text/attached
-- document (frontend, this pass -- reuses the existing
-- proposeTagsScored()/legal-taxonomy.ts suggestion layer already built for
-- judgment_tags, see that file's header).
--
-- Deliberately NOT locked by protect_judgment_lifecycle() (0045): that
-- trigger only names the seven SUBSTANTIVE fields (title/case_number/
-- court_name/judgment_date/citation/content/content_text) as final-locked;
-- a new column it never references is unrestricted by construction, same
-- as is_discoverable already is. This is intentional, not an oversight --
-- classification (category, and judgment_tags, which were already
-- editable regardless of status) is metadata about the record, not part
-- of the judgment's substantive legal text, so a magistrate can still
-- correct/set it after finalizing.
-- ============================================================================

alter table public.judgments
  add column category_id uuid references public.legal_case_categories(id) on delete set null;

create index judgments_category_id_idx on public.judgments (category_id);

comment on column public.judgments.category_id is
  'The type of matter/offence this judgment concerns (legal_case_categories, shared with case_law.category_id, 0073). Nullable: unset until the magistrate confirms it (auto-suggested from an automatic tag scan of the judgment text/uploaded document, frontend-only, never silently applied over an existing value). NOT locked by protect_judgment_lifecycle() (0045) -- editable even when status = ''final'', like is_discoverable.';
