import { cva } from "class-variance-authority";

/**
 * Hierarchy, one of each per surface:
 *   default   — the brand-red commit action (create, save, finalise).
 *   play      — white; reserved for a Billboard's lead action.
 *   more      — translucent on cinematic art; the Billboard's second action.
 *   secondary — the quiet filled button on plain canvas (tools, filters).
 *   outline   — the same weight with an edge, for when it sits on a card.
 *   ghost     — text only; icon buttons and inline controls.
 *   link      — inline text link.
 */
export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold transition-[background-color,color,box-shadow,transform,opacity] duration-150 ease-out-expo focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-elevation-1 hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground shadow-elevation-1 hover:bg-destructive/90",
        outline:
          "border border-input bg-transparent text-foreground hover:bg-foreground/10 hc:hover:bg-accent",
        onDark:
          "border border-amber-200/80 bg-amber-50 text-amber-950 shadow-sm hover:bg-amber-100 hover:text-amber-950",
        secondary:
          "bg-foreground/10 text-foreground hover:bg-foreground/15 hc:bg-secondary hc:hover:bg-accent",
        ghost: "font-medium hover:bg-foreground/10 hover:text-foreground hc:hover:bg-accent",
        link: "font-medium text-link underline-offset-4 hover:underline",
        play: "bg-white font-bold text-black shadow-elevation-1 hover:bg-white/85",
        more: "bg-white/30 font-semibold text-white shadow-sm backdrop-blur-sm hover:bg-white/20",
      },
      // Touch targets: 44px on phones, the compact desktop height from lg
      // up. min-h rather than h so a wrapped label never clips.
      size: {
        default: "min-h-11 px-4 py-2 lg:min-h-9",
        sm: "min-h-9 rounded-md px-3 text-xs lg:min-h-8",
        lg: "min-h-11 rounded-md px-8 lg:min-h-10",
        billboard: "h-12 rounded-md px-8 text-base",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);
