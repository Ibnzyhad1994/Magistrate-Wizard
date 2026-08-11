import { z } from "zod";

/**
 * Lightweight, illustrative grouping labels for Quick Codes — a UI
 * convenience only. The underlying `category` column is plain free text
 * (via ControlledVocabSelect's "Other" escape hatch), kept deliberately
 * separate from the global legal taxonomy/tags system: Quick Codes are
 * personal boilerplate snippets, not legal subject-matter classification.
 */
export const QUICK_CODE_CATEGORIES = [
  "Adjournments",
  "Bail",
  "Sentencing",
  "Evidence",
  "Procedural Orders",
  "Warrants",
  "Maintenance",
  "Juvenile",
  "Administrative",
] as const;

export const quickCodeFieldsSchema = z.object({
  code_word: z.string().min(1, "Code word is required").max(100),
  title: z.string().max(200).optional().or(z.literal("")),
  content: z.string().min(1, "Content is required"),
  description: z.string().max(1000).optional().or(z.literal("")),
  category: z.string().max(100).optional().or(z.literal("")),
});
export type QuickCodeFieldsFormValues = z.infer<typeof quickCodeFieldsSchema>;
