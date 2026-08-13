import { Link } from "react-router-dom";
import { Play, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { TONE_GRADIENT, TONE_ICON, type TitleCardTone } from "@/lib/browse-tones";

interface BillboardAction {
  label: string;
  href?: string;
  onClick?: () => void;
}

interface BillboardProps {
  eyebrow?: string;
  title: string;
  description?: string;
  badges?: string[];
  tone?: TitleCardTone;
  imageUrl?: string | null;
  primaryAction?: BillboardAction;
  secondaryAction?: BillboardAction;
  className?: string;
}

/**
 * Full-bleed homepage hero. Text sits left over a cinematic gradient;
 * chrome fades into the rows below.
 */
export function Billboard({
  eyebrow,
  title,
  description,
  badges,
  tone = "docket",
  imageUrl,
  primaryAction,
  secondaryAction,
  className,
}: BillboardProps) {
  const Icon = TONE_ICON[tone];

  return (
    <section
      className={cn(
        "relative isolate min-h-[78vh] w-full overflow-hidden bg-gradient-to-br",
        TONE_GRADIENT[tone],
        className,
      )}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover object-[center_20%]"
        />
      ) : (
        <>
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_30%,rgba(255,255,255,0.14),transparent_55%)]" />
          <Icon
            className="absolute right-[6%] top-[18%] h-[55vh] w-[55vh] max-w-[46vw] rotate-[-12deg] text-white/10"
            strokeWidth={1}
            aria-hidden="true"
          />
        </>
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-black via-black/75 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#141414] to-transparent" />

      <div className="browse-gutter relative flex min-h-[78vh] max-w-3xl flex-col justify-end pb-24 pt-32">
        {eyebrow && (
          <p className="mb-2 text-sm font-semibold uppercase tracking-[0.22em] text-white/70">
            {eyebrow}
          </p>
        )}
        <h1 className="text-4xl font-extrabold tracking-tight text-white drop-shadow-lg sm:text-5xl lg:text-6xl">
          {title}
        </h1>
        {badges && badges.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {badges.map((badge) => (
              <span
                key={badge}
                className="rounded-[2px] border border-white/30 bg-black/30 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-white"
              >
                {badge}
              </span>
            ))}
          </div>
        )}
        {description && (
          <p className="mt-4 line-clamp-3 max-w-xl text-sm leading-relaxed text-white/85 sm:text-base">
            {description}
          </p>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          {primaryAction && <BillboardButton action={primaryAction} variant="play" icon="play" />}
          {secondaryAction && <BillboardButton action={secondaryAction} variant="more" icon="info" />}
        </div>
      </div>
    </section>
  );
}

function BillboardButton({
  action,
  variant,
  icon,
}: {
  action: BillboardAction;
  variant: "play" | "more";
  icon: "play" | "info";
}) {
  const inner = (
    <>
      {icon === "play" ? (
        <Play className="h-5 w-5 fill-current" aria-hidden="true" />
      ) : (
        <Info className="h-5 w-5" aria-hidden="true" />
      )}
      {action.label}
    </>
  );

  if (action.href) {
    return (
      <Button asChild variant={variant} size="billboard">
        <Link to={action.href} onClick={action.onClick}>
          {inner}
        </Link>
      </Button>
    );
  }

  return (
    <Button variant={variant} size="billboard" onClick={action.onClick}>
      {inner}
    </Button>
  );
}
