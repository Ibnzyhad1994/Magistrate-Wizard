/**
 * Hand-written row aliases over the generated Supabase types.
 *
 * `database.types.ts` is pure `supabase gen types` output and is overwritten
 * by `npm run supabase:types`; anything hand-maintained lives here instead.
 * Import these through `@/types` (`src/types/index.ts` re-exports them).
 */
import type { CompositeTypes, Tables } from "./database.types";

export type Profile = Tables<"profiles">;
export type Court = Tables<"courts">;
export type MagisterialDistrict = Tables<"magisterial_districts">;
export type MagistrateCourt = Tables<"magistrate_courts">;
export type Case = Tables<"cases">;
export type CaseParty = Tables<"case_parties">;
export type BenchNote = Tables<"bench_notes">;
export type Statute = Tables<"statutes">;
export type StatuteProvision = Tables<"statute_provisions">;
export type LegalSource = Tables<"legal_sources">;
export type LegalRegionalGroup = Tables<"legal_regional_groups">;
export type LegalJurisdiction = Tables<"legal_jurisdictions">;
export type LegalAuthorityCourt = Tables<"legal_authority_courts">;
export type LegalCaseCategory = Tables<"legal_case_categories">;
export type ImportBatch = Tables<"import_batches">;
export type ImportJob = Tables<"import_jobs">;
export type CaseLaw = Tables<"case_law">;
export type CaseLawAnnotation = Tables<"case_law_annotations">;
export type Tag = Tables<"tags">;
export type Document = Tables<"documents">;
export type Comment = Tables<"comments">;
export type Bookmark = Tables<"bookmarks">;
export type AuditLogEntry = Tables<"audit_log">;
export type AuthEventLogEntry = Tables<"auth_event_log">;
export type SearchResult = CompositeTypes<"search_result">;

export type DocketMatter = Tables<"docket_matters">;
export type DocketEvent = Tables<"docket_events">;
export type DocketEventCalendarLink = Tables<"docket_event_calendar_links">;
export type DocketMatterParty = Tables<"docket_matter_parties">;
export type DocketMatterTag = Tables<"docket_matter_tags">;
export type DocketMatterAssignment = Tables<"docket_matter_assignments">;
export type DocketMatterJudgment = Tables<"docket_matter_judgments">;
export type DocketMatterCaseLaw = Tables<"docket_matter_case_law">;
export type Judgment = Tables<"judgments">;
export type JudgmentTag = Tables<"judgment_tags">;
export type QuickCode = Tables<"quick_codes">;
export type QuickCodeDocketMatter = Tables<"quick_code_docket_matters">;
export type QuickCodeJudgment = Tables<"quick_code_judgments">;
export type QuickCodeCaseLaw = Tables<"quick_code_case_law">;
export type Share = Tables<"shares">;

export type DocketMatterCategory = Tables<"docket_matter_categories">;
export type DocketCapacitySetting = Tables<"docket_capacity_settings">;
export type DocketCapacityOverride = Tables<"docket_capacity_overrides">;

export type ClerkCourt = Tables<"clerk_courts">;
export type ClerkAccessRequest = Tables<"clerk_access_requests">;
