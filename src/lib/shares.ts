export type ShareItemType = "docket_matter" | "judgment" | "case_law";

/** Canonical Case Law (`owner_id` null) is globally readable and cannot be shared. */
export function isShareableCaseLaw(ownerId: string | null | undefined): boolean {
  return ownerId != null;
}

export function shareNoun(itemType: ShareItemType): string {
  switch (itemType) {
    case "docket_matter":
      return "matter";
    case "judgment":
      return "judgment";
    case "case_law":
      return "research entry";
  }
}

/**
 * Who a share of this item can go to. Clerks can never open judgments or
 * research, so those shares go to magistrates only (0165).
 */
export function shareRecipientRole(itemType: ShareItemType): string {
  return itemType === "docket_matter" ? "magistrate or clerk" : "magistrate";
}

/** Shown when the recipient lookup finds no one the item can be shared with. */
export function shareRecipientNotFound(itemType: ShareItemType): string {
  const who =
    itemType === "docket_matter" ? "an active user" : "an active magistrate who sits a court";
  return `No one found with that email. Check the address. They must be ${who}, and you must be able to share this ${shareNoun(itemType)}.`;
}
