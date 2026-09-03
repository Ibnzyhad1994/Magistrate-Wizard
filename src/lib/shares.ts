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
