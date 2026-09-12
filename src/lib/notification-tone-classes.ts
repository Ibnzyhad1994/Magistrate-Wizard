import type { NotificationTone } from "@/lib/notifications"

/**
 * Tailwind classes for each notification tone, shared by the bell's peek
 * and the full list.
 *
 * Extracted into its own module so the two surfaces cannot drift: amber
 * meaning "waiting on you" is only useful if it means that in both places,
 * and a duplicated map is a map that eventually disagrees with itself.
 *
 * The tokens themselves are defined per theme in index.css, so these work
 * unchanged in light and dark.
 */
export const NOTIFICATION_TONE_ACCENT: Record<NotificationTone, string> = {
  action: "bg-[hsl(var(--notice-action))]",
  granted: "bg-[hsl(var(--notice-granted))]",
  revoked: "bg-[hsl(var(--notice-revoked))]",
  outcome: "bg-[hsl(var(--notice-outcome))]",
}

export const NOTIFICATION_TONE_BADGE: Record<NotificationTone, string> = {
  action:
    "border-[hsl(var(--notice-action))]/40 bg-[hsl(var(--notice-action))]/15 text-[hsl(var(--notice-action))]",
  granted:
    "border-[hsl(var(--notice-granted))]/40 bg-[hsl(var(--notice-granted))]/15 text-[hsl(var(--notice-granted))]",
  revoked:
    "border-[hsl(var(--notice-revoked))]/40 bg-[hsl(var(--notice-revoked))]/15 text-[hsl(var(--notice-revoked))]",
  outcome:
    "border-[hsl(var(--notice-outcome))]/40 bg-[hsl(var(--notice-outcome))]/15 text-[hsl(var(--notice-outcome))]",
}
