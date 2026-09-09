/**
 * Roster vs Pending Requests: an unassigned magistrate can sit in
 * "Waiting for assignment" with no open request (they cancelled, or
 * never submitted after signup). Return-to-requester lives on both
 * surfaces so that person is not stuck with only Assign.
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

/** Shown on both admin and requester surfaces. DB status stays `rejected`. */
export function courtRequestStatusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "approved":
      return "Approved";
    case "rejected":
      return "Returned";
    case "cancelled":
      return "Cancelled";
    case "expired":
      return "Expired";
    default:
      return status;
  }
}

export const COURT_REQUEST_RETURN_NEXT_STEP =
  "You can request again below. If you signed up as the wrong account type, contact a Court Assignment Administrator.";

export const CLERK_ACCESS_RETURN_NEXT_STEP =
  "You can request again below. If you signed up as the wrong account type, contact a Court Assignment Administrator.";

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

export function oppositeStaffAccountType(
  role: string | null | undefined,
): "magistrate" | "clerk" | null {
  if (role === "magistrate") return "clerk";
  if (role === "clerk") return "magistrate";
  return null;
}

export function canCorrectUnassignedAccountType(input: {
  role?: string | null;
  hasActiveMagistrateAssignment: boolean;
  hasActiveClerkAssignment: boolean;
  isOwnProfile: boolean;
}): boolean {
  if (input.isOwnProfile) return false;
  if (oppositeStaffAccountType(input.role) == null) return false;
  return !input.hasActiveMagistrateAssignment && !input.hasActiveClerkAssignment;
}

export function waitingListRequestLabel(pendingCount: number): string | null {
  if (pendingCount <= 0) return null;
  return pendingCount === 1 ? "Open request" : `${pendingCount} open requests`;
}
