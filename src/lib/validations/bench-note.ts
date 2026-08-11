import { z } from "zod";

export const BENCH_NOTE_PARENT_TYPES = [
  "docket_matter",
  "judgment",
  "case_law",
  "statute",
  "statute_provision",
] as const;

/**
 * Parent types selectable from the general "About" dropdown when the
 * dialog is opened WITHOUT a defaultParent (i.e. from the Bench Notes
 * list, not a specific record's page). `statute_provision` is
 * deliberately excluded here — there is no library-wide provision
 * search picker (a single Act can have hundreds of provisions, and the
 * full library many thousands), so a Bench Note about a specific
 * provision can only be created via the "New Bench Note" action on that
 * provision's own reader view, which supplies `defaultParent` directly.
 */
export const BENCH_NOTE_PICKABLE_PARENT_TYPES = [
  "docket_matter",
  "judgment",
  "case_law",
  "statute",
] as const;
export type BenchNoteParentType = (typeof BENCH_NOTE_PARENT_TYPES)[number];

export const benchNoteCreateSchema = z.object({
  title: z.string().min(1, "Title is required").max(300),
  entity_type: z.enum(BENCH_NOTE_PARENT_TYPES, {
    errorMap: () => ({ message: "Choose what this note is about" }),
  }),
  entity_id: z.string().min(1, "Choose a specific record"),
});
export type BenchNoteCreateFormValues = z.infer<typeof benchNoteCreateSchema>;
