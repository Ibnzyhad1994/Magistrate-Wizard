import { z } from "zod";

export const judgmentCreateSchema = z.object({
  title: z.string().min(1, "Title is required").max(300),
  case_number: z.string().max(100).optional().or(z.literal("")),
  court_name: z.string().max(300).optional().or(z.literal("")),
  judgment_date: z.string().optional().or(z.literal("")),
  citation: z.string().max(300).optional().or(z.literal("")),
});
export type JudgmentCreateFormValues = z.infer<typeof judgmentCreateSchema>;

export const judgmentFieldsSchema = z.object({
  title: z.string().min(1, "Title is required").max(300),
  case_number: z.string().max(100).optional().or(z.literal("")),
  court_name: z.string().max(300).optional().or(z.literal("")),
  judgment_date: z.string().optional().or(z.literal("")),
  citation: z.string().max(300).optional().or(z.literal("")),
});
export type JudgmentFieldsFormValues = z.infer<typeof judgmentFieldsSchema>;
