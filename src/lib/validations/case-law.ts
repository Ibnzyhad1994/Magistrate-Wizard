import { z } from "@/lib/zod";
import { isSafeHref } from "@/lib/html-sanitize";

const isParseableUrl = (value: string) => {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
};

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
  // A refine, not .url(): zod 4's .url() also trims the value it returns, and
  // the URL is saved exactly as typed.
  source_url: z
    .string()
    .refine(isParseableUrl, "Enter a valid URL")
    .refine(isSafeHref, "Enter an http(s) URL")
    .optional()
    .or(z.literal("")),
  summary: z.string().max(5000).optional().or(z.literal("")),
  full_text: z.string().optional().or(z.literal("")),
  category_id: z.string().optional().or(z.literal("")),
});
export type CaseLawFieldsFormValues = z.infer<typeof caseLawFieldsSchema>;
