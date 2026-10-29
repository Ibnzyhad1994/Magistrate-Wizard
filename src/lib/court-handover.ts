import { z } from "@/lib/zod";

/**
 * Court hand-over (BE-26, 0220): the pre-flight a magistrate or an
 * administrator sees before an assignment ends. The RPC returns `json`, so
 * this schema is the shape the screens rely on, checked at the data-access
 * boundary.
 *
 * Case numbers and matter and judgment titles come back only to the
 * magistrate whose assignment it is; an administrator gets ids, statuses and
 * dates (ADR 0005, 0007), so those fields are optional here.
 */

const uuid = z.guid();

export const partHeardMatterSchema = z.object({
  docket_matter_id: uuid,
  status: z.string(),
  last_heard_on: z.string().nullable(),
  case_number: z.string().nullable().optional(),
  matter_title: z.string().nullable().optional(),
});

export const pinnedJudgmentSchema = z.object({
  pin_id: uuid,
  judgment_id: uuid,
  docket_matter_id: uuid,
  pinned_at: z.string(),
  judgment_status: z.string(),
  is_discoverable: z.boolean(),
  shared: z.boolean(),
  will_unlink: z.boolean(),
  judgment_title: z.string().nullable().optional(),
});

export const relinquishPreflightSchema = z.object({
  assignment_id: uuid,
  profile_id: uuid,
  court_id: uuid,
  court_name: z.string().nullable(),
  ended: z.boolean(),
  part_heard_unretained_count: z.number().int(),
  pinned_judgment_count: z.number().int(),
  pins_to_unlink_count: z.number().int(),
  part_heard_unretained: z.array(partHeardMatterSchema),
  pinned_judgments: z.array(pinnedJudgmentSchema),
});

export type PartHeardMatter = z.infer<typeof partHeardMatterSchema>;
export type PinnedJudgment = z.infer<typeof pinnedJudgmentSchema>;
export type RelinquishPreflight = z.infer<typeof relinquishPreflightSchema>;

/** The pins that ending the assignment will remove, in the order listed. */
export function pinsToUnlink(preflight: RelinquishPreflight): PinnedJudgment[] {
  return preflight.pinned_judgments.filter((pin) => pin.will_unlink);
}

/** A matter as its magistrate knows it, or by id for an administrator. */
export function matterLabel(matter: PartHeardMatter): string {
  if (matter.case_number && matter.matter_title)
    return `${matter.case_number} · ${matter.matter_title}`;
  return matter.case_number ?? matter.matter_title ?? `Matter ${shortId(matter.docket_matter_id)}`;
}

/** A judgment as its owner knows it, or by id for an administrator. */
export function judgmentLabel(pin: PinnedJudgment): string {
  return pin.judgment_title ?? `Judgment ${shortId(pin.judgment_id)}`;
}

/** The first eight characters of an id: enough to tell rows apart on screen. */
export function shortId(id: string): string {
  return id.slice(0, 8);
}

/** Why a pin survives the hand-over, or that it will not. */
export function pinFate(pin: PinnedJudgment): string {
  if (pin.will_unlink) return "Link removed";
  if (pin.is_discoverable) return "Stays: discoverable";
  if (pin.shared) return "Stays: shared";
  return "Stays: you keep access";
}

const errorCode = (error: unknown): string | undefined =>
  error && typeof error === "object" && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;

/**
 * The pre-flight's refusals, in the screen's words. Null for anything else,
 * so the caller falls back to the shared error message.
 */
export function preflightErrorMessage(error: unknown): string | null {
  switch (errorCode(error)) {
    case "42501":
      return "Only the magistrate on this assignment, or an administrator, can review its hand-over.";
    case "P0002":
      return "This court assignment no longer exists. Refresh the page.";
    default:
      return null;
  }
}

/**
 * True when the pre-flight refused outright (not the magistrate or an
 * administrator, or no such assignment), so the hand-over cannot go ahead
 * from this dialog. Any other failure leaves the confirm open: relinquish
 * itself is never blocked by the pre-flight.
 */
export function preflightRefused(query: { isError: boolean; error: unknown }): boolean {
  return query.isError && preflightErrorMessage(query.error) !== null;
}
