import type { UserRole } from "@/lib/constants";

/**
 * Home's welcome line. The honorific is the person's role: an
 * administrator is not addressed as "Magistrate", and a clerk still
 * waiting for a court is greeted by name alone.
 */
export function homeWelcomeTitle(args: {
  role: UserRole | null;
  name: string | null;
  pendingClerk?: boolean;
}): string {
  const name = args.name?.trim() || null;
  const honorific =
    args.role === "magistrate"
      ? "Magistrate"
      : args.role === "clerk" && !args.pendingClerk
        ? "Clerk"
        : null;
  const address = [honorific, name].filter(Boolean).join(" ");
  return address ? `Welcome, ${address}` : "Welcome";
}
