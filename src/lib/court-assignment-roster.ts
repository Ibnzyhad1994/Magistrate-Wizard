/**
 * Roster vs Pending Requests: an unassigned magistrate can sit in
 * "Waiting for assignment" with no open request (they cancelled, or
 * never submitted after signup). Reject only existed on the pending
 * tab, so that person looked un-actionable except Assign.
 */

export type RosterRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled"
  | "expired";

export interface RosterRequestLike {
  id: string;
  profile_id: string;
  status: RosterRequestStatus | string;
}

export function requestsForProfile<T extends RosterRequestLike>(
  requests: T[] | undefined,
  profileId: string | null | undefined,
): T[] {
  if (!profileId) return [];
  return (requests ?? []).filter((request) => request.profile_id === profileId);
}

export function pendingRequestsForProfile<T extends RosterRequestLike>(
  requests: T[] | undefined,
  profileId: string | null | undefined,
): T[] {
  return requestsForProfile(requests, profileId).filter((request) => request.status === "pending");
}

export function canSendUnassignedMagistrateBack(input: {
  role?: string | null;
  hasActiveAssignment: boolean;
  isOwnProfile: boolean;
}): boolean {
  return input.role === "magistrate" && !input.hasActiveAssignment && !input.isOwnProfile;
}

export function waitingListRequestLabel(pendingCount: number): string | null {
  if (pendingCount <= 0) return null;
  return pendingCount === 1 ? "Open request" : `${pendingCount} open requests`;
}
