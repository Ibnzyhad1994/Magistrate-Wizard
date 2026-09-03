import { z } from "zod";

/**
 * These literal unions mirror LIVE CHECK constraints on `text` columns
 * (verified via `pg_constraint` this session) — the columns themselves
 * are plain `text` in Postgres, not enums, so `database.types.ts` types
 * them as `string`. Keep these lists in sync with the database if a
 * future migration changes the constraint.
 */
export const DOCKET_MATTER_STATUSES = [
  "active",
  "stayed",
  "completed",
  "archived",
] as const;

export const DOCKET_EVENT_STATUSES = [
  "scheduled",
  "completed",
  "cancelled",
  "entered_in_error",
  "past",
] as const;

/**
 * Curated Event Type / Stage vocabularies for Magistrates' Court practice.
 * `docket_events.event_type` and `.stage_at_event` are deliberately
 * UNCONSTRAINED `text` columns in the database (see 0024's own comments
 * and the architecture spec) — no CHECK constraint exists or is added
 * here. These lists exist purely as a UI convenience surfaced through
 * `ControlledVocabSelect` (canonical options + a free-text "Other"
 * escape hatch), so any pre-existing or future free-text value — however
 * it got there — remains fully representable and is never rejected or
 * silently coerced onto the nearest canonical term.
 */
export const EVENT_TYPES = [
  "Hearing",
  "Mention",
  "Arraignment",
  "Trial",
  "Sentencing",
  "Case Management",
  "Preliminary Inquiry",
  "Committal",
  "Bail",
  "Disclosure",
  "Decision/Judgment",
  "Review",
] as const;

export const EVENT_STAGES = [
  "First Appearance",
  "Plea",
  "Preliminary Inquiry",
  "Trial",
  "Continuation",
  "Submission",
  "Decision",
  "Sentencing",
  "Enforcement",
] as const;

export const PARTY_TYPES = [
  "individual",
  "organization",
  "government_body",
  "estate",
  "other",
] as const;

export const PARTY_ROLES = [
  "accused",
  "complainant",
  "applicant",
  "respondent",
  "plaintiff",
  "defendant",
  "petitioner",
  "appellant",
  "appellee",
  "landlord",
  "tenant",
  "child",
  "other",
] as const;

export const PARTY_STATUSES = ["active", "entered_in_error"] as const;

export const SHARE_PERMISSIONS = ["view", "edit"] as const;

/** Lookup row name for the free-text classification escape hatch (0119). */
export const OTHER_MATTER_CATEGORY_NAME = "Other";

export function matterClassificationLabel(
  categoryName: string | null | undefined,
  categoryOther: string | null | undefined,
): string | null {
  if (!categoryName) return null;
  if (categoryName === OTHER_MATTER_CATEGORY_NAME) {
    return categoryOther?.trim() ? categoryOther.trim() : categoryName;
  }
  return categoryName;
}

export const docketMatterSchema = z.object({
  court_id: z.string().min(1, "Court is required"),
  district_id: z.string().min(1, "District is required"),
  case_number: z.string().min(1, "Case number is required").max(100),
  matter_title: z.string().min(1, "Matter title is required").max(300),
  charge_or_issue: z.string().max(2000).optional().or(z.literal("")),
  status: z.enum(DOCKET_MATTER_STATUSES).default("active"),
  category_id: z.string().min(1, "Classification is required"),
  category_other: z.string().max(200).optional().or(z.literal("")),
});
export type DocketMatterFormValues = z.infer<typeof docketMatterSchema>;

/** Identity fields editable after create. Court and district stay locked. */
export const docketMatterIdentitySchema = docketMatterSchema.pick({
  case_number: true,
  matter_title: true,
  charge_or_issue: true,
});
export type DocketMatterIdentityFormValues = z.infer<typeof docketMatterIdentitySchema>;

export const docketMatterClassificationSchema = z.object({
  category_id: z.string().min(1, "Classification is required"),
  category_other: z.string().max(200).optional().or(z.literal("")),
});
export type DocketMatterClassificationFormValues = z.infer<
  typeof docketMatterClassificationSchema
>;

export const docketMatterSchemaForCategories = (otherCategoryId: string | undefined) =>
  docketMatterSchema.superRefine((values, ctx) => {
    if (
      otherCategoryId &&
      values.category_id === otherCategoryId &&
      !values.category_other?.trim()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Describe the matter type",
        path: ["category_other"],
      });
    }
  });

export const docketMatterClassificationSchemaForCategories = (
  otherCategoryId: string | undefined,
) =>
  docketMatterClassificationSchema.superRefine((values, ctx) => {
    if (
      otherCategoryId &&
      values.category_id === otherCategoryId &&
      !values.category_other?.trim()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Describe the matter type",
        path: ["category_other"],
      });
    }
  });

export const docketMatterOutcomeSchema = z.object({
  orders_summary: z.string().max(4000).optional().or(z.literal("")),
  outcome: z.string().max(2000).optional().or(z.literal("")),
});
export type DocketMatterOutcomeFormValues = z.infer<
  typeof docketMatterOutcomeSchema
>;

export const docketEventSchema = z.object({
  scheduled_date: z.string().min(1, "Date is required"),
  scheduled_time: z.string().optional().or(z.literal("")),
  event_type: z.string().max(200).optional().or(z.literal("")),
  location: z.string().max(300).optional().or(z.literal("")),
  stage_at_event: z.string().max(200).optional().or(z.literal("")),
  outcome_at_event: z.string().max(2000).optional().or(z.literal("")),
  orders_made_at_event: z.string().max(2000).optional().or(z.literal("")),
  notes: z.string().max(4000).optional().or(z.literal("")),
  event_status: z.enum(DOCKET_EVENT_STATUSES).default("scheduled"),
  /** Matter category for daily capacity purposes (0076) — optional, independent of event_type. */
  category_id: z.string().optional().or(z.literal("")),
});
export type DocketEventFormValues = z.infer<typeof docketEventSchema>;

export const docketPartySchema = z.object({
  full_name: z.string().min(1, "Name is required").max(300),
  party_type: z.enum(PARTY_TYPES).default("individual"),
  role: z.enum(PARTY_ROLES, { required_error: "Role is required" }),
  attorney_name: z.string().max(300).optional().or(z.literal("")),
  contact_info: z.string().max(1000).optional().or(z.literal("")),
  party_status: z.enum(PARTY_STATUSES).default("active"),
});
export type DocketPartyFormValues = z.infer<typeof docketPartySchema>;

export const docketTagSchema = z.object({
  tag_name: z.string().min(1, "Tag is required").max(60),
});
export type DocketTagFormValues = z.infer<typeof docketTagSchema>;

export const createShareSchema = z.object({
  recipient_email: z.string().min(1, "Recipient email is required").email(),
  permission: z.enum(SHARE_PERMISSIONS).default("view"),
});
export type CreateShareFormValues = z.infer<typeof createShareSchema>;
