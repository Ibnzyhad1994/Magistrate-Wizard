import { cva } from "class-variance-authority";

export const alertVariants = cva(
  "relative w-full rounded-md border border-border border-l-2 bg-card px-4 py-3 text-sm text-foreground [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-3.5 [&>svg]:size-4 [&>svg~*]:pl-7",
  {
    variants: {
      variant: {
        default: "border-l-foreground/40 [&>svg]:text-muted-foreground",
        info: "border-l-info bg-info/10 [&>svg]:text-info",
        warning: "border-l-warning bg-warning/10 [&>svg]:text-warning",
        success: "border-l-success bg-success/10 [&>svg]:text-success",
        destructive: "border-l-destructive bg-destructive/10 [&>svg]:text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);
