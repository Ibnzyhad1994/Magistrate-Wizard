import { Link } from "react-router-dom";
import { Play, Plus, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { TONE_GRADIENT, type TitleCardTone } from "@/lib/browse-tones";

interface TitleCardProps {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  meta?: string[];
  badge?: string;
  tone?: TitleCardTone;
  href?: string;
  onClick?: () => void;
  className?: string;
}

/**
 * Netflix-style browse tile. Portrait 2:3 poster with a delayed hover
 * lift that reveals metadata and actions. Touch devices skip the hover
 * chrome and just navigate.
 */
export function TitleCard({
  title,
  eyebrow,
  subtitle,
  meta,
  badge,
  tone = "docket",
  href,
  onClick,
  className,
}: TitleCardProps) {
  const body = (
    <article
      className={cn(
        "group relative w-[42vw] min-w-[9.5rem] max-w-[13.5rem] origin-center cursor-pointer sm:w-[28vw] md:w-[18vw] lg:w-[14vw] xl:w-[12vw]",
        className,
      )}
    >
      <div
        className={cn(
          "relative aspect-[2/3] overflow-hidden rounded-sm bg-gradient-to-br transition-transform duration-300 ease-out",
          "group-hover:z-20 group-hover:scale-110 group-hover:shadow-[0_16px_32px_rgba(0,0,0,0.75)]",
          TONE_GRADIENT[tone],
        )}
      >
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.12),transparent_55%)]" />
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />

        {badge && (
          <span className="absolute left-2 top-2 rounded-[2px] bg-primary px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
            {badge}
          </span>
        )}

        <div className="absolute inset-x-0 bottom-0 p-2.5">
          {eyebrow && (
            <p className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-white/70">
              {eyebrow}
            </p>
          )}
          <h3 className="mt-0.5 line-clamp-3 text-sm font-bold leading-snug text-white">
            {title}
          </h3>
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex translate-y-2 flex-col gap-2 p-2.5 opacity-0 transition-all duration-200 group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-black">
              <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
            </span>
            <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white/50 bg-black/40 text-white">
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <span className="ml-auto flex h-7 w-7 items-center justify-center rounded-full border-2 border-white/50 bg-black/40 text-white">
              <Info className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          </div>
          {subtitle && (
            <p className="line-clamp-2 text-[11px] text-white/80">{subtitle}</p>
          )}
          {meta && meta.length > 0 && (
            <p className="truncate text-[11px] text-white/60">{meta.join(" · ")}</p>
          )}
        </div>
      </div>
    </article>
  );

  if (href) {
    return (
      <Link to={href} onClick={onClick} className="block">
        {body}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className="block text-left">
      {body}
    </button>
  );
}
