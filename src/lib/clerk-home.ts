export type ClerkHomeState = "loading" | "pending" | "ready"

/**
 * Clerk Home must follow the live seat (`clerk_courts`), not the request
 * table. Requests explain a pending clerk; they do not grant Docket.
 * While courts are still loading, do not flash "ready" or "request access".
 */
export function clerkHomeState(args: {
  courtsPending: boolean
  courtCount: number
}): ClerkHomeState {
  if (args.courtsPending) return "loading"
  if (args.courtCount > 0) return "ready"
  return "pending"
}

export function clerkPendingDescription(args: {
  pendingRequestCount: number
  pendingCourtName?: string | null
}): string {
  if (args.pendingRequestCount === 1) {
    const court = args.pendingCourtName?.trim()
    return court
      ? `Your request to access the docket for ${court} is awaiting approval from the assigned magistrate.`
      : "Your court access request is awaiting approval from the assigned magistrate."
  }
  if (args.pendingRequestCount > 1) {
    return "Your court access requests are awaiting approval from each court's assigned magistrate."
  }
  return "Request access to a court to get started. The court's assigned magistrate will review your request."
}
