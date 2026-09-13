import { Link } from "react-router-dom";
import { ArrowLeft, Play, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useRegisterCinematicNav } from "@/components/layout/use-cinematic-nav";
import { useTheme } from "@/providers/use-theme";
import { isDarkPalette } from "@/lib/theme";
import { TONE_GRADIENT_HERO, TONE_ICON, type TitleCardTone } from "@/lib/browse-tones";

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
  /** Court sitting (and similar) — follows hero ink, not the paper fade. */
  caption?: string;
  className?: string;
  /**
   * `hero` is the cinematic dashboard splash. `detail` is compact so
   * work chrome (tabs, editors) is reachable without scrolling past
   * a full-viewport billboard.
   */
  variant?: "hero" | "detail";
  tourId?: string;
}

type BillboardButtonVariant = "play" | "more" | "default" | "outline";

/**
 * Full-bleed homepage hero. Dark keeps the cinematic gradient; light is a
 * chambers wash so Welcome copy is ink on paper, not white on navy.
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
  caption,
  className,
  variant = "hero",
  tourId,
}: BillboardProps) {
  const { resolvedTheme } = useTheme();
  const cinematic = isDarkPalette(resolvedTheme);
  useRegisterCinematicNav();
  const Icon = TONE_ICON[tone];
  const isDetail = variant === "detail";

  return (
    <section
      data-tour={tourId ?? (isDetail ? undefined : "home-billboard")}
      className={cn(
        "relative isolate w-full overflow-hidden bg-gradient-to-br",
        isDetail ? "min-h-0" : "min-h-[78vh]",
        TONE_GRADIENT_HERO[tone],
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
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_30%,hsl(var(--primary)/0.08),transparent_55%)] dark:bg-[radial-gradient(ellipse_at_70%_30%,hsl(var(--foreground)/0.14),transparent_55%)]" />
          <Icon
            className={cn(
              "absolute right-[6%] top-[18%] rotate-[-12deg] text-foreground/10 dark:text-primary-foreground/10",
              isDetail
                ? "h-[18vh] w-[18vh] max-w-[32vw]"
                : "h-[55vh] w-[55vh] max-w-[46vw]",
            )}
            strokeWidth={1}
            aria-hidden="true"
          />
        </>
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-background via-background/75 to-transparent dark:from-black dark:via-black/75 dark:to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background to-transparent sm:h-28" />

      <div
        className={cn(
          "browse-gutter relative flex max-w-3xl flex-col justify-end",
          isDetail
            ? "min-h-0 pb-10 pt-20"
            : caption
              ? "min-h-[78vh] pb-32 pt-32"
              : "min-h-[78vh] pb-24 pt-32",
        )}
      >
        {eyebrow && (
          <p className="mb-2 text-sm font-semibold uppercase tracking-[0.22em] text-foreground/70 dark:text-primary-foreground/70">
            {eyebrow}
          </p>
        )}
        <h1
          data-tour-focus={isDetail ? "" : undefined}
          className={cn(
            "w-fit font-extrabold tracking-tight text-foreground dark:text-primary-foreground dark:drop-shadow-lg",
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
                className="rounded-[2px] border border-border bg-background/80 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-foreground dark:border-primary-foreground/30 dark:bg-black/30 dark:text-primary-foreground"
              >
                {badge}
              </span>
            ))}
          </div>
        )}
        {description && (
          <p
            className={cn(
              "max-w-xl leading-relaxed text-foreground/80 dark:text-primary-foreground/85",
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
              variant={cinematic ? "play" : "default"}
              icon={isDetail ? "back" : "play"}
              compact={isDetail}
            />
          )}
          {secondaryAction && (
            <BillboardButton
              action={secondaryAction}
              variant={cinematic ? "more" : "outline"}
              icon="info"
              compact={isDetail}
            />
          )}
          {tertiaryAction && (
            <BillboardButton
              action={tertiaryAction}
              variant={cinematic ? "more" : "outline"}
              icon="info"
              compact={isDetail}
            />
          )}
        </div>
        {caption ? (
          <p className="mt-4 text-sm font-medium text-foreground/70 dark:text-primary-foreground/80">
            {caption}
          </p>
        ) : null}
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
  variant: BillboardButtonVariant;
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
