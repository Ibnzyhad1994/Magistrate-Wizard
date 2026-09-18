import type { CSSProperties, ReactNode } from "react";
import { BrowseViewSelect } from "@/components/browse/browse-view-select";
import { usePageTitle } from "@/hooks/use-page-title";
import type { BrowseView } from "@/lib/browse-prefs";
import { TONE_HSL_VAR, TONE_ICON, type TitleCardTone } from "@/lib/browse-tones";
import { cn } from "@/lib/utils";

interface BrowseHeaderProps {
  title: string;
  description?: string;
  /** Small uppercase line above the title (a workspace name, a court). */
  eyebrow?: string;
  action?: ReactNode;
  /** Hide the Tiles / List control (e.g. Settings, admin tools). */
  showViewSelect?: boolean;
  viewSelectValue?: BrowseView;
  onViewSelectChange?: (view: BrowseView) => void;
  dataTour?: string;
  /**
   * Washes the band in the workspace's colour and sets its icon as faint
   * set dressing. Without a tone the band is a neutral lift off the
   * canvas, which is what admin and utility pages want.
   */
  tone?: TitleCardTone;
}

/**
 * Page header as a compact billboard: an edge-to-edge band under the
 * fixed nav with the title set on the display scale, so every browse
 * page opens the way Home does rather than as a heading on bare canvas.
 */
export function BrowseHeader({
  title,
  description,
  eyebrow,
  action,
  showViewSelect = false,
  viewSelectValue,
  onViewSelectChange,
  dataTour,
  tone,
}: BrowseHeaderProps) {
  usePageTitle(title);
  const Icon = tone ? TONE_ICON[tone] : null;
  return (
    <header
      className={cn(
        "browse-bleed relative isolate -mt-[calc(6rem+env(safe-area-inset-top))] mb-8 overflow-hidden pb-8 pt-[calc(6rem+env(safe-area-inset-top))]",
        tone ? "tone-band" : "bg-gradient-to-b from-foreground/[0.05] to-transparent",
      )}
      style={tone ? ({ "--band": TONE_HSL_VAR[tone] } as CSSProperties) : undefined}
    >
      {Icon && (
        <Icon
          className="pointer-events-none absolute -right-[2vw] -top-[1vw] hidden h-[13rem] w-auto rotate-[-12deg] text-foreground/[0.06] md:block"
          strokeWidth={1}
          aria-hidden="true"
        />
      )}
      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {eyebrow && <p className="text-eyebrow mb-2 text-muted-foreground">{eyebrow}</p>}
          <h1 className="w-fit text-display text-foreground" data-tour={dataTour}>
            {title}
          </h1>
          {description && (
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {(showViewSelect || action) && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {showViewSelect && (
              <BrowseViewSelect value={viewSelectValue} onChange={onViewSelectChange} />
            )}
            {action}
          </div>
        )}
      </div>
    </header>
  );
}
