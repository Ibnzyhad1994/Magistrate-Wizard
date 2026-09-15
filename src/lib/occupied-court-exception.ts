/**
 * Occupancy and special seating exceptions for magistrate courts.
 *
 * A pending request never fills a court. An approved regular sitting
 * occupies the primary slot only after that person has signed in — the
 * same signal /admin/people uses for last login. Until then the court
 * stays available. Two magistrates at one court is an admin-only
 * exception: replace the incumbent, or co-sit the newcomer as acting.
 */

export type OccupiedCourtResolution = "replace" | "co_sit";

export const OCCUPIED_COURT_EXCEPTION_LABEL = "Special exception";

export function occupiedResolutionLabel(resolution: OccupiedCourtResolution): string {
  return resolution === "replace"
    ? "Replace the current primary magistrate"
    : "Seat a second magistrate alongside them";
}

export function occupiedResolutionHint(resolution: OccupiedCourtResolution): string {
  return resolution === "replace"
    ? "The current primary assignment ends. This person becomes the primary magistrate."
    : "The current primary stays. This person sits as acting so two magistrates cover the court.";
}

export function requestNeedsOccupiedResolution(input: {
  requestKind?: string | null;
  courtIsOccupied: boolean;
}): boolean {
  return input.courtIsOccupied || input.requestKind === "occupied_exception";
}

/** Pending requests never occupy a court, regardless of kind. */
export function pendingRequestOccupiesCourtSlot(_status: "pending"): false {
  return false;
}

/**
 * Matches /admin/people: only a current regular sitting whose person has
 * a recorded successful sign-in fills the court's primary slot.
 */
export function primaryAssignmentOccupiesCourtSlot(input: {
  assignmentType: string;
  endedAt: string | null | undefined;
  lastLoginAt: string | null | undefined;
}): boolean {
  return input.assignmentType === "regular" && !input.endedAt && Boolean(input.lastLoginAt);
}

export function occupiedExceptionSubmitMessage(isOccupied: boolean): string {
  return isOccupied
    ? "Special exception request submitted. A Court Assignment Administrator will decide whether to replace the current magistrate or seat you alongside them."
    : "Court assignment request submitted.";
}
