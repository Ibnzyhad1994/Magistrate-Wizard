/**
 * Pure resolution logic for the two-level Docket (All My Courts / one
 * specific court). Kept framework-free so it can be unit tested without
 * a router or a live query — docket-list-page.tsx is the only caller,
 * and owns turning a "redirect" result into an actual navigation.
 *
 * `courtId: null` always means "All My Courts" throughout this module —
 * never "every court in the database." The combined view is scoped
 * entirely by which ids appear in `myCourtIds`, which the caller derives
 * from the signed-in user's own current court assignments (magistrate or
 * clerk) — this module never sees or trusts a full court reference list.
 */

export type DocketScopeResult =
  | { status: "loading" }
  | { status: "resolved"; courtId: string | null }
  | { status: "redirect"; courtId: string | null };

/**
 * Explicit `?court=` value for "All My Courts" as a deliberate, sticky
 * choice -- distinct from the param being absent entirely (which instead
 * falls through to the remembered-scope-or-default logic below). Without
 * this, clearing the param to go back to All My Courts is immediately
 * re-overridden by a still-remembered specific court on the very next
 * resolve, trapping the user in whichever court they last viewed.
 */
export const ALL_COURTS_PARAM = "all";

export function resolveDocketScope(args: {
  /** The `court` URL search param verbatim: null if absent, ALL_COURTS_PARAM for an explicit All My Courts, or a court id. */
  requestedCourtId: string | null;
  /** The signed-in user's own currently-authorized court ids. `undefined` while still loading. */
  myCourtIds: string[] | undefined;
  /** Same-device remembered scope from a previous visit (see store's own re-validation note). */
  rememberedCourtId: string | null;
}): DocketScopeResult {
  const { requestedCourtId, myCourtIds, rememberedCourtId } = args;
  if (myCourtIds === undefined) return { status: "loading" };

  if (requestedCourtId === ALL_COURTS_PARAM) {
    return { status: "resolved", courtId: null };
  }

  if (requestedCourtId !== null) {
    if (myCourtIds.includes(requestedCourtId)) {
      return { status: "resolved", courtId: requestedCourtId };
    }
    // Explicitly requested a court the user is not (or no longer)
    // authorized for -- never silently apply it. Redirect to a safe
    // default instead: their one court if they have exactly one,
    // otherwise All My Courts.
    return {
      status: "redirect",
      courtId: myCourtIds.length === 1 ? myCourtIds[0] : null,
    };
  }

  // No ?court= param at all.
  if (myCourtIds.length === 1) {
    // A single-court user goes straight to their court -- still via an
    // explicit URL (not just an in-memory default), so the scope stays
    // bookmarkable and survives a refresh identically.
    return { status: "redirect", courtId: myCourtIds[0] };
  }
  if (rememberedCourtId && myCourtIds.includes(rememberedCourtId)) {
    return { status: "redirect", courtId: rememberedCourtId };
  }
  // No single-court shortcut and no valid remembered scope -- All My
  // Courts, which needs no redirect since a bare /docket already IS that
  // URL.
  return { status: "resolved", courtId: null };
}

/** Docket page heading, e.g. "Docket: All My Courts" / "Docket: Vigilance Magistrates' Court 1". */
export function docketScopeTitle(courtName: string | null): string {
  return courtName ? `Docket: ${courtName}` : "Docket: All My Courts";
}
