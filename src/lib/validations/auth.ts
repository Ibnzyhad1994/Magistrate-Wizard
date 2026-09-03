import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
  rememberMe: z.boolean().default(false),
});
export type LoginFormValues = z.infer<typeof loginSchema>;

/**
 * `accountType` decides what this form collects and, via
 * useAuth().signUp, which SAFE literal signal ("clerk") gets sent as
 * `requested_role` signup metadata -- anything other than the literal
 * string "clerk" resolves to the safe "magistrate" default server-side
 * (handle_new_user(), 0086), and no signup path can ever reach "admin".
 * Both account types now collect a district + one-or-more courts:
 * handle_new_user() creates one PENDING request per selected court --
 * clerk_access_requests for a clerk, magistrate_court_requests for a
 * magistrate (0106) -- never an immediate assignment. Selecting a court
 * here is a request, not a grant.
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
