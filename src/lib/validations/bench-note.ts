import { z } from "zod";

export const BENCH_NOTE_PARENT_TYPES = [
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
