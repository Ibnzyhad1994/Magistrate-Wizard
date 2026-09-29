import * as React from "react";
import * as SheetPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { guardDismiss } from "@/components/ui/dismiss-guard";

const Sheet = SheetPrimitive.Root;
const SheetTrigger = SheetPrimitive.Trigger;
const SheetClose = SheetPrimitive.Close;
const SheetPortal = SheetPrimitive.Portal;

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-dialog bg-black/80 ease-out-expo data-[state=closed]:duration-180 data-[state=open]:duration-240 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
    ref={ref}
  />
));
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;

const sheetVariants = cva(
  "fixed z-dialog gap-4 bg-card p-6 text-foreground shadow-none ease-out-expo data-[state=closed]:duration-180 data-[state=open]:duration-240 data-[state=open]:animate-in data-[state=closed]:animate-out",
  {
    // Each side keeps its content clear of the notch, the home indicator
    // and a landscape phone's rounded corners on the edges it touches
    // (env() is 0 everywhere else, so desktop padding is unchanged).
    variants: {
      side: {
        top: "inset-x-0 top-0 border-b border-border pt-[calc(1.5rem+env(safe-area-inset-top,0px))] data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
        bottom:
          "inset-x-0 bottom-0 border-t border-border pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
        left: "inset-y-0 left-0 h-full w-3/4 border-r border-border pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] pl-[calc(1.5rem+env(safe-area-inset-left,0px))] pt-[calc(1.5rem+env(safe-area-inset-top,0px))] data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
        right:
          "inset-y-0 right-0 h-full w-3/4 border-l border-border pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] pr-[calc(1.5rem+env(safe-area-inset-right,0px))] pt-[calc(1.5rem+env(safe-area-inset-top,0px))] data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm",
      },
    },
    defaultVariants: {
      side: "right",
    },
  },
);

interface SheetContentProps
  extends
    React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetVariants> {
  /** See `DialogContent`: blocks outside-click / Escape while a form is dirty. */
  preventDismissWhenDirty?: boolean;
}

const SheetContent = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Content>,
  SheetContentProps
>(
  (
    {
      side = "right",
      className,
      preventDismissWhenDirty = false,
      onInteractOutside,
      onEscapeKeyDown,
      children,
      ...props
    },
    ref,
  ) => (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        ref={ref}
        className={cn(sheetVariants({ side }), className)}
        onInteractOutside={(event) => {
          onInteractOutside?.(event);
          guardDismiss(preventDismissWhenDirty, event);
        }}
        onEscapeKeyDown={(event) => {
          onEscapeKeyDown?.(event);
          guardDismiss(preventDismissWhenDirty, event);
        }}
        {...props}
      >
        {children}
        {/* A 44px target below lg with the icon where it always sat (24px
            from the corner), pushed below the notch; lg keeps the icon-sized
            button. */}
        <SheetPrimitive.Close
          className={cn(
            "absolute flex h-11 w-11 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none lg:right-4 lg:top-4 lg:block lg:h-auto lg:w-auto",
            side === "bottom" ? "top-0.5" : "top-[calc(0.125rem+env(safe-area-inset-top,0px))]",
            side === "right"
              ? "right-[calc(0.125rem+env(safe-area-inset-right,0px))]"
              : "right-0.5",
          )}
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPortal>
  ),
);
SheetContent.displayName = SheetPrimitive.Content.displayName;

const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-2 text-center sm:text-left", className)} {...props} />
);
SheetHeader.displayName = "SheetHeader";

const SheetFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)}
    {...props}
  />
);
SheetFooter.displayName = "SheetFooter";

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title
    ref={ref}
    className={cn("text-lg font-bold text-foreground", className)}
    {...props}
  />
));
SheetTitle.displayName = SheetPrimitive.Title.displayName;

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
SheetDescription.displayName = SheetPrimitive.Description.displayName;

export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};
