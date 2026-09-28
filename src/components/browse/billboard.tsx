import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Play, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useRegisterCinematicNav } from "@/components/layout/use-cinematic-nav";
import { useTheme } from "@/providers/use-theme";
import { isDarkPalette } from "@/lib/theme";
import {
  TONE_GRADIENT_HERO,
  TONE_HSL_VAR,
  TONE_ICON,
  type TitleCardTone,
} from "@/lib/browse-tones";

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
   * `hero` is the cinematic dashboard splash. `detail` is a record's page
   * header: the browse pages' tone band, so work chrome (tabs, editors)
   * is reachable without scrolling past a full-viewport billboard.
   */
  variant?: "hero" | "detail";
  tourId?: string;
}

type BillboardButtonVariant = "play" | "more" | "default" | "outline" | "ghost";

export function Billboard(props: BillboardProps) {
  return props.variant === "detail" ? <DetailBillboard {...props} /> : <HeroBillboard {...props} />;
}

/**
 * Full-bleed homepage hero. Dark keeps the cinematic gradient; light is a
 * chambers wash so Welcome copy is ink on paper, not white on navy.
 */
function HeroBillboard({
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
  tourId,
}: BillboardProps) {
  const { resolvedTheme } = useTheme();
  const cinematic = isDarkPalette(resolvedTheme);
  useRegisterCinematicNav();
  const Icon = TONE_ICON[tone];

  return (
    <section
      data-tour={tourId ?? "home-billboard"}
      className={cn(
        "relative isolate min-h-[78vh] w-full overflow-hidden bg-gradient-to-br",
        TONE_GRADIENT_HERO[tone],
        className,
      )}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover object-[center_20%]"
        />
      ) : (
        <>
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_30%,hsl(var(--primary)/0.08),transparent_55%)] dark:bg-[radial-gradient(ellipse_at_70%_30%,hsl(var(--foreground)/0.14),transparent_55%)]" />
          <Icon
            className="absolute right-[6%] top-[18%] h-[55vh] w-[55vh] max-w-[46vw] rotate-[-12deg] text-foreground/10 dark:text-primary-foreground/10"
            strokeWidth={1}
            aria-hidden="true"
          />
        </>
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-background via-background/75 to-transparent dark:from-black dark:via-black/75 dark:to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background to-transparent sm:h-28" />

      <div
        className={cn(
          "browse-gutter relative flex min-h-[78vh] max-w-3xl flex-col justify-end pt-32",
          caption ? "pb-32" : "pb-24",
        )}
      >
        {eyebrow && (
          <p className="mb-2 text-sm font-semibold uppercase tracking-[0.22em] text-foreground/70 dark:text-primary-foreground/70">
            {eyebrow}
          </p>
        )}
        <h1 className="w-fit text-4xl font-extrabold tracking-tight text-foreground dark:text-primary-foreground dark:drop-shadow-lg sm:text-5xl lg:text-6xl">
          {title}
        </h1>
        {badges && badges.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
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
          <p className="mt-4 line-clamp-3 max-w-xl text-sm leading-relaxed text-foreground/80 dark:text-primary-foreground/85 sm:text-base">
            {description}
          </p>
        )}
        <div data-tour-focus="" className="mt-6 flex flex-wrap gap-3">
          {primaryAction && (
            <BillboardButton
              action={primaryAction}
              variant={cinematic ? "play" : "default"}
              icon="play"
            />
          )}
          {secondaryAction && (
            <BillboardButton
              action={secondaryAction}
              variant={cinematic ? "more" : "outline"}
              icon="info"
            />
          )}
          {tertiaryAction && (
            <BillboardButton
              action={tertiaryAction}
              variant={cinematic ? "more" : "outline"}
              icon="info"
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

/**
 * A record's page header, drawn with the same tone band as `BrowseHeader`
 * so a detail page opens the way the list it came from does: no art, no
 * set-dressing icon, the title on the display scale. It sits on plain
 * canvas, so the nav keeps its resting fade and the actions are quiet
 * tools. A cover photo is a party's identification photo, shown only as
 * a small documentary inset, never as the backdrop.
 */
function DetailBillboard({
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
  tourId,
}: BillboardProps) {
  return (
    <section
      data-tour={tourId}
      className={cn(
        "tone-band relative isolate w-full overflow-hidden pb-10 pt-[calc(6rem+env(safe-area-inset-top))]",
        className,
      )}
      style={{ "--band": TONE_HSL_VAR[tone] } as CSSProperties}
    >
      <div className="browse-gutter relative flow-root">
        {/* Floats so only the first lines of a long title wrap beside it. */}
        {imageUrl && (
          <img
            src={imageUrl}
            alt=""
            decoding="async"
            className="float-right mb-2 ml-4 h-16 w-14 rounded-md border border-hairline object-cover object-[center_20%] shadow-elevation-1 hc:border-border sm:ml-6 sm:h-28 sm:w-24"
          />
        )}
        {eyebrow && (
          // Full ink, not muted: the eyebrow sits where the band is
          // strongest, and muted ink there falls under 4.5:1 in light.
          <p className="mb-2 text-sm font-semibold uppercase tracking-[0.22em] text-foreground">
            {eyebrow}
          </p>
        )}
        {/* Phones step the display size down to 26px so a long case
            title stays at three or four lines. */}
        <h1
          data-tour-focus=""
          className="w-fit max-w-5xl text-display text-foreground max-sm:text-[1.625rem] max-sm:leading-[1.1]"
        >
          {title}
        </h1>
        {badges && badges.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {badges.map((badge) => (
              <span
                key={badge}
                className="rounded-sm border border-input px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-foreground"
              >
                {badge}
              </span>
            ))}
          </div>
        )}
        {description && (
          <p className="mt-3 line-clamp-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
        <div data-tour-focus="" className="mt-4 flex flex-wrap gap-3">
          {primaryAction && (
            <BillboardButton action={primaryAction} variant="ghost" icon="back" tool />
          )}
          {secondaryAction && (
            <BillboardButton action={secondaryAction} variant="ghost" icon="info" tool />
          )}
          {tertiaryAction && (
            <BillboardButton action={tertiaryAction} variant="ghost" icon="info" tool />
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
  tool = false,
}: {
  action: BillboardAction;
  variant: BillboardButtonVariant;
  icon: "play" | "info" | "back";
  /** The page's tool size (as in a detail page's action row), kept at 44px below lg. */
  tool?: boolean;
}) {
  const iconClass = tool ? "h-4 w-4" : "h-5 w-5";
  const size = tool ? "sm" : "billboard";
  const sizeClass = tool ? "max-lg:min-h-11" : undefined;
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
      <Button asChild variant={variant} size={size} className={sizeClass}>
        <Link to={action.href} onClick={action.onClick}>
          {inner}
        </Link>
      </Button>
    );
  }

  return (
    <Button variant={variant} size={size} className={sizeClass} onClick={action.onClick}>
      {inner}
    </Button>
  );
}
