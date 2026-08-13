import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  TONE_GRADIENT,
  TONE_ICON,
  TONE_LABEL,
  type TitleCardTone,
} from "@/lib/browse-tones";

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
}

/**
 * Browse tile. Portrait 2:3 poster. When `imageUrl` is set (matter cover
 * or party identification photo), that photograph is the artwork; otherwise
 * a tone-colored gradient plus a large Lucide mark identifies the kind of
 * record. Docket tiles also print case number, charge, and court on the
 * cover so the file is readable at rest.
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
}: TitleCardProps) {
  const Icon = TONE_ICON[tone];
  const hasPhoto = Boolean(imageUrl);

  const body = (
    <article
      className={cn(
        "group relative w-[42vw] min-w-[9.5rem] max-w-[13.5rem] shrink-0 origin-center cursor-pointer sm:w-[28vw] md:w-[18vw] lg:w-[14vw] xl:w-[12vw]",
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
        {hasPhoto ? (
          <img
            src={imageUrl!}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <>
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.12),transparent_55%)]" />
            <Icon
              className="absolute right-[-6%] top-[18%] h-[46%] w-[46%] rotate-[-16deg] text-white/15"
              strokeWidth={1.25}
              aria-hidden="true"
            />
          </>
        )}
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/90 via-black/45 to-transparent" />

        <span className="absolute right-2 top-2 text-[9px] font-bold uppercase tracking-[0.18em] text-white/55">
          {TONE_LABEL[tone]}
        </span>

        {badge && (
          <span className="absolute left-2 top-2 rounded-[2px] bg-primary px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
            {badge}
          </span>
        )}

        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1 p-2.5">
          {eyebrow && (
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/75">
              {eyebrow}
            </p>
          )}
          <h3 className="line-clamp-3 text-sm font-bold leading-snug text-white">{title}</h3>
          {subtitle && (
            <p className="line-clamp-4 text-[11px] leading-snug text-white/80">{subtitle}</p>
          )}
          {meta && meta.length > 0 && (
            <p className="truncate text-[10px] text-white/55">{meta.join(" · ")}</p>
          )}
        </div>
      </div>
    </article>
  );

  if (href) {
    return (
      <Link to={href} onClick={onClick} className="block shrink-0 snap-start">
        {body}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className="block shrink-0 snap-start text-left">
      {body}
    </button>
  );
}
