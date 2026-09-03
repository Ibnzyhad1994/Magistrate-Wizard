import type { UserRole } from "@/lib/constants"

export type AuthStatus = "loading" | "authenticated" | "unauthenticated" | "locked"

export type ProtectedRouteGate =
  | "loading"
  | "login"
  | "unauthorized"
  | "pending-clerk"
  | "pending-magistrate"
  | "ok"

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
 *
 * `requireApprovedMagistrateCourt` is the same pattern for role='magistrate':
 * a magistrate with zero currently-active magistrate_courts assignments
 * (brand new signup, awaiting Court Assignment Administrator review, or
 * rejected and yet to be re-approved) is deliberately kept out of the
 * "full suite" of the application — everything except the Court
 * Assignments status/tracking page itself — until an admin approves a
 * court. A no-op for every other role: an admin who is also a sitting
 * magistrate is gated on ROLE, not on holding a magistrate_courts row, so
 * this never blocks them (they need full access regardless, including to
 * approve their own or others' requests).
 */
export function resolveProtectedRouteGate(args: {
  status: AuthStatus
  profile: { role: UserRole } | null
  allowedRoles?: UserRole[]
  requireApprovedClerkCourt?: boolean
  hasApprovedClerkCourt?: boolean
  requireApprovedMagistrateCourt?: boolean
  hasApprovedMagistrateCourt?: boolean
}): ProtectedRouteGate {
  if (args.status === "loading") return "loading"
  if (args.status === "unauthenticated") return "login"
  // Idle/JWT lock keeps the current route mounted so drafts survive.
  if (args.allowedRoles && args.allowedRoles.length > 0) {
    if (!args.profile) return "loading"
    if (!args.allowedRoles.includes(args.profile.role)) return "unauthorized"
  }
  if (args.requireApprovedClerkCourt && args.profile?.role === "clerk") {
    if (args.hasApprovedClerkCourt === undefined) return "loading"
    if (!args.hasApprovedClerkCourt) return "pending-clerk"
  }
  if (args.requireApprovedMagistrateCourt && args.profile?.role === "magistrate") {
    if (args.hasApprovedMagistrateCourt === undefined) return "loading"
    if (!args.hasApprovedMagistrateCourt) return "pending-magistrate"
  }
  return "ok"
}
