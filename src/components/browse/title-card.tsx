import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  TONE_GRADIENT,
  TONE_ICON,
  TONE_LABEL,
  type TitleCardTone,
} from "@/lib/browse-tones";
import { LIST_THUMB_CLASS, TILE_WIDTH_CLASS, type BrowseView } from "@/lib/browse-prefs";
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
 * Browse tile. Portrait 2:3 poster in tile view; a compact row in list
 * view. Size and view come from Settings unless `layout` overrides.
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

  const artwork = hasPhoto ? (
    <img
      src={imageUrl!}
      alt=""
      className="absolute inset-0 h-full w-full object-cover"
    />
  ) : (
    <>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,hsl(var(--foreground)/0.12),transparent_55%)]" />
      <Icon
        className={cn(
          layout === "list"
            ? "right-[-18%] top-[12%] h-[70%] w-[70%] rotate-[-16deg] text-foreground/15"
            : "right-[-6%] top-[18%] h-[46%] w-[46%] rotate-[-16deg] text-primary-foreground/20",
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
          "group relative flex w-full min-w-0 items-stretch overflow-hidden rounded-sm bg-foreground/[0.04] transition-colors hover:bg-foreground/[0.09]",
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
          {artwork}
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-3 py-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              {eyebrow && (
                <p className="truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground/70">
                  {eyebrow}
                </p>
              )}
              <h3 className="line-clamp-1 text-sm font-bold leading-snug text-foreground">{title}</h3>
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
          "group relative shrink-0 origin-center cursor-pointer",
          TILE_WIDTH_CLASS[tileSize],
          className,
        )}
      >
        <div
          className={cn(
            "relative aspect-[2/3] overflow-hidden rounded-sm bg-gradient-to-br transition-transform duration-300 ease-out",
            "group-hover:z-20 group-hover:scale-110 group-hover:shadow-lg dark:group-hover:shadow-[0_16px_32px_rgba(0,0,0,0.75)]",
            TONE_GRADIENT[tone],
          )}
        >
          {artwork}
          <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/90 via-black/45 to-transparent" />

          <span className="absolute right-2 top-2 text-[9px] font-bold uppercase tracking-[0.18em] text-primary-foreground/70">
            {TONE_LABEL[tone]}
          </span>

          {badge && (
            <span className="absolute left-2 top-2 rounded-[2px] bg-primary px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary-foreground">
              {badge}
            </span>
          )}

          <div className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 p-2">
            {eyebrow && (
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-primary-foreground/80">
                {eyebrow}
              </p>
            )}
            <h3 className="line-clamp-3 text-[13px] font-bold leading-snug text-primary-foreground">{title}</h3>
            {subtitle && (
              <p className="line-clamp-3 text-[11px] leading-snug text-primary-foreground/85">{subtitle}</p>
            )}
            {meta && meta.length > 0 && (
              <p className="truncate text-[10px] text-primary-foreground/70">{meta.join(" · ")}</p>
            )}
            {children}
          </div>
        </div>
      </article>
    );

  const wrapClass = layout === "list" ? "block w-full min-w-0" : "block shrink-0 snap-start";

  if (href) {
    return (
      <Link to={href} onClick={onClick} className={wrapClass} data-tour={dataTour}>
        {body}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={`${wrapClass} text-left`}>
      {body}
    </button>
  );
}
