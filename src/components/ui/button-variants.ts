import { cva } from "class-variance-authority";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        outline:
          "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground",
        onDark:
          "border border-amber-200/80 bg-amber-50 text-amber-950 shadow-sm hover:bg-amber-100 hover:text-amber-950",
        secondary: "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-link underline-offset-4 hover:underline",
        play: "bg-white text-black font-bold shadow hover:bg-white/85",
        more: "bg-white/30 text-white font-semibold shadow-sm hover:bg-white/20 backdrop-blur-sm",
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
