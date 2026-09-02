import { Link } from "react-router-dom";
import { ArrowLeft, Play, Info } from "lucide-react";
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
  tertiaryAction?: BillboardAction;
  className?: string;
  /**
   * `hero` is the cinematic dashboard splash. `detail` is compact so
   * work chrome (tabs, editors) is reachable without scrolling past
   * a full-viewport billboard.
   */
  variant?: "hero" | "detail";
  tourId?: string;
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
  tertiaryAction,
  className,
  variant = "hero",
  tourId,
}: BillboardProps) {
  const Icon = TONE_ICON[tone];
  const isDetail = variant === "detail";

  return (
    <section
      data-tour={tourId ?? (isDetail ? undefined : "home-billboard")}
      className={cn(
        "relative isolate w-full overflow-hidden bg-gradient-to-br",
        isDetail ? "min-h-0" : "min-h-[78vh]",
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
            className={cn(
              "absolute right-[6%] top-[18%] rotate-[-12deg] text-white/10",
              isDetail
                ? "h-[18vh] w-[18vh] max-w-[32vw]"
                : "h-[55vh] w-[55vh] max-w-[46vw]",
            )}
            strokeWidth={1}
            aria-hidden="true"
          />
        </>
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-black via-black/75 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#141414] to-transparent sm:h-40" />

      <div
        className={cn(
          "browse-gutter relative flex max-w-3xl flex-col justify-end",
          isDetail
            ? "min-h-0 pb-10 pt-20"
            : "min-h-[78vh] pb-24 pt-32",
        )}
      >
        {eyebrow && (
          <p className="mb-2 text-sm font-semibold uppercase tracking-[0.22em] text-white/70">
            {eyebrow}
          </p>
        )}
        <h1
          data-tour-focus={isDetail ? "" : undefined}
          className={cn(
            "w-fit font-extrabold tracking-tight text-white drop-shadow-lg",
            isDetail
              ? "text-2xl sm:text-3xl lg:text-4xl"
              : "text-4xl sm:text-5xl lg:text-6xl",
          )}
        >
          {title}
        </h1>
        {badges && badges.length > 0 && (
          <div className={cn("flex flex-wrap gap-2", isDetail ? "mt-2" : "mt-4")}>
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
          <p
            className={cn(
              "max-w-xl leading-relaxed text-white/85",
              isDetail
                ? "mt-2 line-clamp-2 text-sm"
                : "mt-4 line-clamp-3 text-sm sm:text-base",
            )}
          >
            {description}
          </p>
        )}
        <div
          data-tour-focus=""
          className={cn("flex flex-wrap gap-3", isDetail ? "mt-4" : "mt-6")}
        >
          {primaryAction && (
            <BillboardButton
              action={primaryAction}
              variant="play"
              icon={isDetail ? "back" : "play"}
              compact={isDetail}
            />
          )}
          {secondaryAction && (
            <BillboardButton
              action={secondaryAction}
              variant="more"
              icon="info"
              compact={isDetail}
            />
          )}
          {tertiaryAction && (
            <BillboardButton
              action={tertiaryAction}
              variant="more"
              icon="info"
              compact={isDetail}
            />
          )}
        </div>
      </div>
    </section>
  );
}

function BillboardButton({
  action,
  variant,
  icon,
  compact = false,
}: {
  action: BillboardAction;
  variant: "play" | "more";
  icon: "play" | "info" | "back";
  compact?: boolean;
}) {
  const iconClass = compact ? "h-4 w-4" : "h-5 w-5";
  const inner = (
    <>
      {icon === "back" ? (
        <ArrowLeft className={iconClass} aria-hidden="true" />
      ) : icon === "play" ? (
        <Play className={cn(iconClass, "fill-current")} aria-hidden="true" />
      ) : (
        <Info className={iconClass} aria-hidden="true" />
      )}
      {action.label}
    </>
  );

  if (action.href) {
    return (
      <Button asChild variant={variant} size={compact ? "default" : "billboard"}>
        <Link to={action.href} onClick={action.onClick}>
          {inner}
        </Link>
      </Button>
    );
  }

  return (
    <Button variant={variant} size={compact ? "default" : "billboard"} onClick={action.onClick}>
      {inner}
    </Button>
  );
}
