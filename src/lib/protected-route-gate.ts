import type { UserRole } from "@/lib/constants"

export type AuthStatus = "loading" | "authenticated" | "unauthenticated"

export type ProtectedRouteGate = "loading" | "login" | "unauthorized" | "pending-clerk" | "ok"

/**
 * Pure gate for ProtectedRoute. Session can restore before the profile
 * row has loaded — admin deep-links must wait, not bounce to /unauthorized.
 *
 * `requireApprovedClerkCourt` additionally gates on the clerk having at
 * least one currently-active clerk_courts assignment (only meaningful for
 * role='clerk' — a no-op for every other role). `hasApprovedClerkCourt`
 * is `undefined` while that check is still loading, which this treats the
 * same as the profile-loading case: wait, never briefly render Docket
 * content before the check resolves, and never bounce a pending clerk to
 * /unauthorized (they belong at the pending-approval experience instead).
 */
export function resolveProtectedRouteGate(args: {
  status: AuthStatus
  profile: { role: UserRole } | null
  allowedRoles?: UserRole[]
  requireApprovedClerkCourt?: boolean
  hasApprovedClerkCourt?: boolean
}): ProtectedRouteGate {
  if (args.status === "loading") return "loading"
  if (args.status === "unauthenticated") return "login"
  if (args.allowedRoles && args.allowedRoles.length > 0) {
    if (!args.profile) return "loading"
    if (!args.allowedRoles.includes(args.profile.role)) return "unauthorized"
  }
  if (args.requireApprovedClerkCourt && args.profile?.role === "clerk") {
    if (args.hasApprovedClerkCourt === undefined) return "loading"
    if (!args.hasApprovedClerkCourt) return "pending-clerk"
  }
  return "ok"
}
