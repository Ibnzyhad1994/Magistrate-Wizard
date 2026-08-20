import { z } from "zod";

/**
 * Shared shape for creating/editing PERSONAL research (owner_id = caller).
 * Canonical Case Law creation/editing is Admin-only per backend RLS and is
 * deliberately not exposed anywhere in this magistrate-facing frontend.
 */
export const caseLawFieldsSchema = z.object({
  case_name: z.string().min(1, "Case name is required").max(300),
  citation: z.string().min(1, "Citation is required").max(300),
  court: z.string().min(1, "Court is required").max(300),
  jurisdiction: z.string().min(1, "Jurisdiction is required").max(200),
  decided_date: z.string().optional().or(z.literal("")),
  source_url: z.string().url("Enter a valid URL").optional().or(z.literal("")),
  summary: z.string().max(5000).optional().or(z.literal("")),
  full_text: z.string().optional().or(z.literal("")),
  category_id: z.string().optional().or(z.literal("")),
});
export type CaseLawFieldsFormValues = z.infer<typeof caseLawFieldsSchema>;
