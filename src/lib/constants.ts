/**
 * Application-wide constants. Keep this file free of environment-specific
 * secrets — those belong in `src/lib/supabase.ts` via `import.meta.env`.
 */

export const APP_NAME = "Magistrate Wizard";
export const APP_DESCRIPTION =
  "A legal knowledge management platform for magistrates.";

export const LOCAL_STORAGE_KEYS = {
  theme: "magistrate-wizard-theme",
  sidebarCollapsed: "magistrate-wizard-sidebar-collapsed",
  auth: "magistrate-wizard-auth",
  rememberMe: "magistrate-wizard-remember-me",
  hearingReminders: "magistrate-wizard-hearing-reminders",
  hearingReminderSent: "magistrate-wizard-hearing-reminder-sent",
} as const;

export const QUERY_STALE_TIME_MS = 30_000;
export const QUERY_GC_TIME_MS = 5 * 60_000;

export const USER_ROLES = ["magistrate", "clerk", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ROLE_LABELS: Record<UserRole, string> = {
  magistrate: "Magistrate",
  clerk: "Clerk",
  admin: "Administrator",
};
