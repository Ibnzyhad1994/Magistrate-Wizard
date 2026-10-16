import type { VariantProps } from "class-variance-authority";
import type { badgeVariants } from "@/components/ui/badge-variants";

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

/**
 * One badge colour per record status, shared by every status badge
 * (docket matters, hearing events, judgments, bench notes, callovers,
 * court and clerk requests) so the same word never means two colours.
 *
 * Green is live or in force, grey is not yet or no longer live, and red
 * is reserved for a refusal or an error. The brand red `default` badge is
 * never a status: it would compete with the surface's one commit action.
 */
const STATUS_BADGE_VARIANT: Record<string, BadgeVariant> = {
  active: "success",
  approved: "success",
  final: "success",
  published: "success",
  scheduled: "success",
  in_progress: "success",
  pending: "outline",
  draft: "secondary",
  stayed: "secondary",
  completed: "outline",
  archived: "outline",
  cancelled: "secondary",
  expired: "secondary",
  past: "secondary",
  dismissed: "destructive",
  rejected: "destructive",
  entered_in_error: "destructive",
};

export function statusBadgeVariant(status: string): BadgeVariant {
  return STATUS_BADGE_VARIANT[status] ?? "outline";
}

/**
 * The same map as a dot fill, for the status flag on a browse tile:
 * green when live, red when refused, neutral otherwise. Each fill clears
 * 3:1 against the flag's card chip in every palette.
 */
const STATUS_DOT_CLASS: Partial<Record<BadgeVariant, string>> = {
  success: "bg-success",
  destructive: "bg-destructive",
};

export function statusDotClass(status: string): string {
  return STATUS_DOT_CLASS[statusBadgeVariant(status)] ?? "bg-muted-foreground";
}
