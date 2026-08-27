import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});
export type LoginFormValues = z.infer<typeof loginSchema>;

/**
 * `accountType` is a pure UI/form concept -- it only ever decides what
 * this form collects and, via useAuth().signUp, which SAFE literal
 * signal ("clerk") gets sent as `requested_role` signup metadata. The
 * real authorization boundary is server-side (handle_new_user(), 0086):
 * anything other than the literal string "clerk" resolves to the
 * existing safe "magistrate" default, and no signup path can ever reach
 * "admin". Choosing "Magistrate" here collects nothing extra and changes
 * nothing about the existing, unmodified magistrate signup outcome --
 * still zero Court access until an admin separately assigns one.
 */
export const registerSchema = z
  .object({
    accountType: z.enum(["magistrate", "clerk"]),
    fullName: z
      .string()
      .min(2, "Full name must be at least 2 characters")
      .max(100, "Full name is too long"),
    email: z.string().min(1, "Email is required").email("Enter a valid email address"),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(/[A-Z]/, "Password must contain an uppercase letter")
      .regex(/[a-z]/, "Password must contain a lowercase letter")
      .regex(/[0-9]/, "Password must contain a number"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
    staffId: z.string().max(50, "Staff ID is too long").optional(),
    districtId: z.string().optional(),
    courtIds: z.array(z.string()).optional(),
    note: z.string().max(500, "Note is too long").optional(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })
  .superRefine((data, ctx) => {
    if (data.accountType !== "clerk") return;
    if (!data.districtId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select your Magisterial District",
        path: ["districtId"],
      });
    }
    if (!data.courtIds || data.courtIds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select at least one court to request access to",
        path: ["courtIds"],
      });
    }
  });
export type RegisterFormValues = z.infer<typeof registerSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email address"),
});
export type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>;
