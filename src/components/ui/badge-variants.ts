import { cva } from "class-variance-authority";

export const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground shadow hover:bg-destructive/80",
        outline: "text-foreground",
        // A record that is live or in force (active, approved, final).
        // Brand red is kept for the one commit action, so a live status is
        // never red. The light tint stays at 5% because green ink on a
        // deeper light tint drops below 4.5:1.
        success: "border-success/40 bg-success/5 text-success dark:bg-success/15",
        // Restrained brass/gold treatment reserved for institutional /
        // canonical content (shared, admin-curated — not a personal
        // record). Never used as a general-purpose accent.
        canonical: "border-brass/30 bg-brass/10 text-brass-foreground dark:text-brass",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);
