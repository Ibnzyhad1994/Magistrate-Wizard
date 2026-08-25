/**
 * Shared helpers for the Docket Capacity feature's visual indicators.
 * Traffic-light system (green/amber/red), replacing the earlier
 * progressive white-to-red gradient — explicit discrete bands, static
 * hex values (never a dynamically-constructed Tailwind class name like
 * `bg-red-${n}`, which is invisible to Tailwind's compiler unless
 * safelisted). Color is always paired with the numeric count/status text
 * wherever it's used — never color-only.
 */

export type CapacityBand = "not_set" | "green" | "amber" | "full" | "over_capacity";

interface CapacityStyle {
  band: CapacityBand;
  /** Inline background color — deterministic, not a dynamic Tailwind class. */
  bg: string;
  /** Static Tailwind text-color class, chosen per band for guaranteed contrast against `bg`. */
  textClass: string;
  /** Suffix shown next to "X of Y" — only FULL and OVER CAPACITY get one, per spec. */
  label: string | null;
  bold: boolean;
}

/**
 * scheduledCount / dailyCapacity, NOT capped before the over-capacity
 * check — a null/undefined dailyCapacity means "not configured" and must
 * never be treated as 0 or rendered as full.
 *
 * Thresholds: <50% green, 50–99% amber, exactly 100% full (red), >100%
 * over capacity (darker red + a distinct warning treatment) — a plain
 * empty date (0 scheduled) is green ("readily available"), not a
 * separate white/neutral state; only a genuinely unconfigured category
 * gets the neutral "not_set" treatment.
 */
export function getCapacityStyle(scheduledCount: number, dailyCapacity: number | null | undefined): CapacityStyle {
  if (dailyCapacity == null) {
    return { band: "not_set", bg: "transparent", textClass: "text-muted-foreground", label: null, bold: false };
  }

  const ratio = scheduledCount / dailyCapacity; // deliberately NOT capped — over_capacity depends on the true ratio

  if (ratio > 1) {
    return { band: "over_capacity", bg: "#7f1d1d", textClass: "text-white", label: "OVER CAPACITY", bold: true };
  }
  if (ratio === 1) {
    return { band: "full", bg: "#dc2626", textClass: "text-white", label: "FULL", bold: true };
  }
  if (ratio >= 0.5) {
    return { band: "amber", bg: "#f59e0b", textClass: "text-neutral-900", label: null, bold: false };
  }
  return { band: "green", bg: "#22c55e", textClass: "text-neutral-900", label: null, bold: false };
}

export function capacityStatusLabel(status: string): string {
  switch (status) {
    case "not_set":
      return "Capacity not set";
    case "full":
      return "Full";
    case "over_capacity":
      return "Over capacity";
    case "amber":
      return "Busy";
    default:
      return "Available";
  }
}
