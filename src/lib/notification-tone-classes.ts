import type { NotificationTone } from "@/lib/notifications";

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
  action: "bg-notice-action",
  granted: "bg-notice-granted",
  revoked: "bg-notice-revoked",
  outcome: "bg-notice-outcome",
};

export const NOTIFICATION_TONE_BADGE: Record<NotificationTone, string> = {
  action: "border-notice-action/40 bg-notice-action/15 text-notice-action",
  granted: "border-notice-granted/40 bg-notice-granted/15 text-notice-granted",
  revoked: "border-notice-revoked/40 bg-notice-revoked/15 text-notice-revoked",
  outcome: "border-notice-outcome/40 bg-notice-outcome/15 text-notice-outcome",
};
