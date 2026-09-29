/**
 * Segmented control: the boxed toggle for a small view switch (docket
 * Weekly / Daily / Monthly, calendar Month / Agenda), built from ghost
 * Buttons with `aria-pressed` inside a `role="group"` track.
 */
export const SEGMENT_TRACK_CLASS = "rounded-md bg-surface-2 p-0.5 hc:border hc:border-border";

/**
 * The selected segment sits one surface step above its surface-2 track:
 * surface-1 in light, surface-3 in dark and colourblind dark (where
 * surface-1 is darker than the track and read as recessed). High contrast
 * inverts to foreground, on hover too: the ghost Button's
 * `hc:hover:bg-accent` would otherwise put the inverted label on grey.
 */
export const SEGMENT_ON_CLASS =
  "bg-surface-1 text-foreground shadow-elevation-1 hover:bg-surface-1 dim:bg-surface-3 hc:bg-foreground hc:text-background hc:hover:bg-foreground";
