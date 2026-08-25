import { AlertTriangle } from "lucide-react";
import { getCapacityStyle } from "@/lib/docket-capacity";

/**
 * The single shared rendering of a capacity band — used by the Settings
 * panel, the Add/Edit Event dialog's inline readout, the always-visible
 * Docket-page capacity strip, and the matter Events tab. One
 * implementation so every surface stays visually identical, and so a
 * future band/contrast change only needs to happen once.
 */
export function CapacityIndicator({
  categoryName,
  scheduledCount,
  dailyCapacity,
  variant = "bar",
}: {
  categoryName: string;
  scheduledCount: number;
  dailyCapacity: number | null;
  variant?: "bar" | "chip";
}) {
  const style = getCapacityStyle(scheduledCount, dailyCapacity);

  if (style.band === "not_set") {
    return variant === "bar" ? (
      <div className="flex items-center justify-between rounded px-2 py-1 text-xs text-muted-foreground">
        <span>{categoryName}</span>
        <span>Capacity not set</span>
      </div>
    ) : (
      <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
        {categoryName} — not set
      </span>
    );
  }

  const countText = `${scheduledCount} / ${dailyCapacity}`;

  if (variant === "chip") {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full border border-black/10 px-2 py-0.5 text-[11px] ${style.textClass} ${style.bold ? "font-bold" : "font-medium"}`}
        style={{ backgroundColor: style.bg }}
        title={`${categoryName}: ${countText}${style.label ? ` — ${style.label}` : ""}`}
      >
        {style.band === "over_capacity" && <AlertTriangle className="h-3 w-3" />}
        {categoryName} — {countText}
        {style.label ? ` ${style.label}` : ""}
      </span>
    );
  }

  return (
    <div
      className={`flex items-center justify-between gap-2 rounded border border-black/10 px-2 py-1 text-xs ${style.textClass}`}
      style={{ backgroundColor: style.bg }}
    >
      <span className={style.bold ? "font-bold" : undefined}>{categoryName}</span>
      <span className={`flex items-center gap-1 ${style.bold ? "font-bold" : "font-medium"}`}>
        {style.band === "over_capacity" && <AlertTriangle className="h-3.5 w-3.5" />}
        {countText}
        {style.label ? ` — ${style.label}` : ""}
      </span>
    </div>
  );
}
