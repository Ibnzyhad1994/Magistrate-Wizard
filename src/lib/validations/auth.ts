import { z } from "@/lib/zod";
import { PASSWORD_RULES } from "@/lib/auth/password-policy";

/**
 * A password someone is choosing (registration, reset). Every rule reports,
 * so the form lists all that is missing at once, and the rules are the ones
 * Supabase Auth enforces (password-policy.ts), so a password the form
 * accepts is never refused as weak by the server.
 */
const newPasswordSchema = PASSWORD_RULES.reduce(
  (schema, rule) => schema.refine(rule.test, rule.message),
  z.string(),
);

export const loginSchema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
  rememberMe: z.boolean().default(false),
});
export type LoginFormValues = z.infer<typeof loginSchema>;
/** What the form holds before parsing: `rememberMe` may still be unset. */
export type LoginFormInput = z.input<typeof loginSchema>;

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
 * here is a request, not a grant. The form requires an explicit Magistrate
 * or Court Clerk choice (no pre-selected type) so a clerk is less likely
 * to request as a magistrate by accident.
 */
export const registerSchema = z
  .object({
    accountType: z.enum(["magistrate", "clerk"], { error: "Choose Magistrate or Court Clerk" }),
    fullName: z
      .string()
      .min(2, "Full name must be at least 2 characters")
      .max(100, "Full name is too long"),
    email: z.string().min(1, "Email is required").email("Enter a valid email address"),
    password: newPasswordSchema,
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
        code: "custom",
        message: "Select your Magisterial District",
        path: ["districtId"],
      });
    }
    if (!data.courtIds || data.courtIds.length === 0) {
      ctx.addIssue({
        code: "custom",
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

/** Same password policy as registerSchema (newPasswordSchema). */
export const resetPasswordSchema = z
  .object({
    password: newPasswordSchema,
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
export type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>;
