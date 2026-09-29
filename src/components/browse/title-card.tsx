import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { TONE_GRADIENT, TONE_ICON, TONE_LABEL, type TitleCardTone } from "@/lib/browse-tones";
import { LIST_THUMB_CLASS, type BrowseView } from "@/lib/browse-prefs";
import { useUiStore } from "@/store/ui-store";

interface TitleCardProps {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  meta?: string[];
  badge?: string;
  tone?: TitleCardTone;
  imageUrl?: string | null;
  href?: string;
  onClick?: () => void;
  className?: string;
  /** Force tiles layout even when Settings is set to List (dashboard carousels). */
  layout?: BrowseView;
  children?: ReactNode;
  dataTour?: string;
}

/**
 * Browse tile. A 16:9 still in tile view, with the words below the art on
 * the card surface, never over it; a compact row in list view. The still
 * fills the width its container gives it (`TitleGallery`, `ContentRow`);
 * view comes from Settings unless `layout` overrides.
 */
export function TitleCard({
  title,
  eyebrow,
  subtitle,
  meta,
  badge,
  tone = "docket",
  imageUrl,
  href,
  onClick,
  className,
  layout: layoutOverride,
  children,
  dataTour,
}: TitleCardProps) {
  const storedView = useUiStore((s) => s.browseView);
  const tileSize = useUiStore((s) => s.tileSize);
  const layout = layoutOverride ?? storedView;
  const Icon = TONE_ICON[tone];
  const hasPhoto = Boolean(imageUrl);

  const toneArt = (
    <>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,hsl(var(--foreground)/0.12),transparent_55%)]" />
      <Icon
        className={cn(
          layout === "list"
            ? "right-[-18%] top-[12%] h-[70%] w-[70%] rotate-[-16deg] text-foreground/15"
            : "absolute right-[6%] top-[26%] h-[60%] w-auto rotate-[-16deg] text-primary-foreground/20",
        )}
        strokeWidth={1.25}
        aria-hidden="true"
      />
    </>
  );

  const body =
    layout === "list" ? (
      <article
        className={cn(
          "group relative flex w-full min-w-0 items-stretch overflow-hidden rounded-sm bg-foreground/[0.04] transition-colors duration-120 ease-out-expo hover-fine:hover:bg-foreground/[0.09]",
          className,
        )}
      >
        <div
          className={cn(
            "relative shrink-0 overflow-hidden bg-gradient-to-br",
            LIST_THUMB_CLASS[tileSize],
            TONE_GRADIENT[tone],
          )}
        >
          {hasPhoto ? (
            <img
              src={imageUrl!}
              alt=""
              loading="lazy"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            toneArt
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-3 py-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              {eyebrow && (
                <p className="truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground/70">
                  {eyebrow}
                </p>
              )}
              <h3 className="line-clamp-1 text-sm font-bold leading-snug text-foreground">
                {title}
              </h3>
            </div>
            {badge && (
              <span className="shrink-0 rounded-[2px] bg-primary px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary-foreground">
                {badge}
              </span>
            )}
          </div>
          {subtitle && (
            <p className="line-clamp-2 text-[12px] leading-snug text-foreground/75">{subtitle}</p>
          )}
          {meta && meta.length > 0 && (
            <p className="truncate text-[11px] text-foreground/50">{meta.join(" · ")}</p>
          )}
          {children}
        </div>
      </article>
    ) : (
      <article
        className={cn(
          "flex h-full flex-col overflow-hidden rounded-lg border border-hairline bg-card transition-colors duration-120 ease-out-expo hc:border-border",
          "hover-fine:group-hover/still:border-surface-3 hover-fine:group-hover/still:bg-surface-2 hc:hover-fine:group-hover/still:border-border",
          className,
        )}
      >
        <div
          className={cn(
            "relative aspect-video shrink-0 overflow-hidden bg-gradient-to-br",
            TONE_GRADIENT[tone],
          )}
        >
          {toneArt}
          {/* A cover is an identification photo of a party: it is shown
              only as a small documentary inset, never as the still. */}
          {hasPhoto && (
            <img
              src={imageUrl!}
              alt=""
              loading="lazy"
              decoding="async"
              className="absolute bottom-2 left-2 aspect-[3/4] h-[46%] w-auto rounded-sm object-cover shadow-elevation-1 ring-1 ring-primary-foreground/30"
            />
          )}

          <div className="absolute inset-x-2 top-2 flex flex-row-reverse flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 truncate text-[9px] font-bold uppercase tracking-[0.18em] text-primary-foreground/70">
              {TONE_LABEL[tone]}
            </span>

            {badge && (
              <span className="mr-auto shrink-0 rounded-[2px] bg-primary px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary-foreground">
                {badge}
              </span>
            )}
          </div>
        </div>

        {/* 11px plus the 1px border: text sits 12px in from the still's
            edge, which the 136px floor is sized for. */}
        <div className="flex flex-col gap-0.5 px-[11px] pb-3 pt-2.5">
          {eyebrow && (
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {eyebrow}
            </p>
          )}
          <h3 className="line-clamp-4 text-sm font-semibold leading-[1.3] text-foreground [text-wrap:pretty]">
            {title}
          </h3>
          {subtitle && (
            <p className="line-clamp-2 text-xs leading-snug text-muted-foreground">{subtitle}</p>
          )}
          {meta && meta.length > 0 && (
            <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
              {meta.join(" · ")}
            </p>
          )}
          {children}
        </div>
      </article>
    );

  const wrapClass = cn(
    "group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    layout === "list"
      ? "block w-full min-w-0 rounded-md"
      : "group/still block w-full min-w-0 snap-start rounded-lg",
  );

  if (href) {
    return (
      <Link to={href} onClick={onClick} className={wrapClass} data-tour={dataTour}>
        {body}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={cn(wrapClass, "text-left")}>
      {body}
    </button>
  );
}
