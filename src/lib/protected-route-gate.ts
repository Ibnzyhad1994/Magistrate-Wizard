import type { UserRole } from "@/lib/constants"

export type AuthStatus = "loading" | "authenticated" | "unauthenticated"

export type ProtectedRouteGate = "loading" | "login" | "unauthorized" | "ok"

/**
 * Pure gate for ProtectedRoute. Session can restore before the profile
 * row has loaded — admin deep-links must wait, not bounce to /unauthorized.
 */
export function resolveProtectedRouteGate(args: {
  status: AuthStatus
  profile: { role: UserRole } | null
  allowedRoles?: UserRole[]
}): ProtectedRouteGate {
  if (args.status === "loading") return "loading"
  if (args.status === "unauthenticated") return "login"
  if (args.allowedRoles && args.allowedRoles.length > 0) {
    if (!args.profile) return "loading"
    if (!args.allowedRoles.includes(args.profile.role)) return "unauthorized"
  }
  return "ok"
}
