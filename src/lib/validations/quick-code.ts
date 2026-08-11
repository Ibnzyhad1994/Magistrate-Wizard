import { z } from "zod";

export const quickCodeFieldsSchema = z.object({
  code_word: z.string().min(1, "Code word is required").max(100),
  title: z.string().max(200).optional().or(z.literal("")),
  content: z.string().min(1, "Content is required"),
  description: z.string().max(1000).optional().or(z.literal("")),
});
export type QuickCodeFieldsFormValues = z.infer<typeof quickCodeFieldsSchema>;
