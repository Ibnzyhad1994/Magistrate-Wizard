import type { CSSProperties } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { TONE_HSL_VAR, TONE_ICON, type TitleCardTone } from "@/lib/browse-tones";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  /**
   * Cinematic variant for a browse page that has nothing to show yet: a
   * tone wash with the workspace's icon as faint set dressing and the
   * copy set as a title, so an empty tab reads as a stage waiting for its
   * first record rather than a broken list.
   */
  tone?: TitleCardTone;
}

/**
 * In-content (not full-page) empty state — used inside cards, tab panels,
 * and list views when there is genuinely nothing to show yet.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  tone,
}: EmptyStateProps) {
  if (tone) {
    const ToneIcon = Icon ?? TONE_ICON[tone];
    return (
      <div
        className={cn(
          "tone-band relative isolate flex min-h-[18rem] flex-col justify-end overflow-hidden rounded-md border border-hairline px-6 py-8 hc:border-border sm:min-h-[20rem] sm:px-10 sm:py-10",
          className,
        )}
        style={{ "--band": TONE_HSL_VAR[tone] } as CSSProperties}
      >
        <ToneIcon
          className="pointer-events-none absolute -right-6 -top-6 h-[65%] w-auto rotate-[-12deg] text-foreground/[0.07]"
          strokeWidth={1}
          aria-hidden="true"
        />
        <div className="relative max-w-md">
          <p className="text-title-lg text-foreground">{title}</p>
          {description && (
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
          )}
          {action && <div className="mt-5">{action}</div>}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-md px-6 py-16 text-center",
        className,
      )}
    >
      {Icon && <Icon className="h-8 w-8 text-muted-foreground" aria-hidden="true" />}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
