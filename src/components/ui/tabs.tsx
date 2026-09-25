import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";
import { hScrollMask, useHScroll } from "@/hooks/use-h-scroll";

/**
 * `underline` (default) is the browse-page rail: text on the canvas with
 * a brand-red rule under the active tab. `segmented` is the boxed toggle
 * for a small control inside a card (view switches, two-way choices).
 */
type TabsVariant = "underline" | "segmented";

const TabsVariantContext = React.createContext<TabsVariant>("underline");

const Tabs = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root> & { variant?: TabsVariant }
>(({ variant = "underline", ...props }, ref) => (
  <TabsVariantContext.Provider value={variant}>
    <TabsPrimitive.Root ref={ref} {...props} />
  </TabsVariantContext.Provider>
));
Tabs.displayName = TabsPrimitive.Root.displayName;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => {
  const variant = React.useContext(TabsVariantContext);
  const localRef = React.useRef<HTMLDivElement | null>(null);
  const { canScrollLeft, canScrollRight } = useHScroll(localRef, props.children);
  const maskImage = hScrollMask(canScrollLeft, canScrollRight);

  const setRef = (node: HTMLDivElement | null) => {
    localRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  };

  return (
    <TabsPrimitive.List
      ref={setRef}
      style={maskImage ? { WebkitMaskImage: maskImage, maskImage } : undefined}
      className={cn(
        "scrollbar-none flex h-auto w-full max-w-full items-center justify-start overflow-x-auto overscroll-x-contain scroll-smooth text-muted-foreground",
        variant === "underline"
          ? "min-h-11 gap-6 border-b border-hairline hc:border-border"
          : "min-h-10 gap-0.5 rounded-md bg-surface-2 p-0.5 hc:border hc:border-border",
        className,
      )}
      {...props}
    />
  );
});
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, onClick, onFocus, ...props }, ref) => {
  const variant = React.useContext(TabsVariantContext);
  const handleBringIntoView = (target: HTMLElement) => {
    target.scrollIntoView({
      inline: "center",
      block: "nearest",
      behavior: "smooth",
    });
  };

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    handleBringIntoView(event.currentTarget);
    onClick?.(event);
  };

  const handleFocus = (event: React.FocusEvent<HTMLButtonElement>) => {
    handleBringIntoView(event.currentTarget);
    onFocus?.(event);
  };

  return (
    <TabsPrimitive.Trigger
      ref={ref}
      onClick={handleClick}
      onFocus={handleFocus}
      className={cn(
        "inline-flex shrink-0 items-center justify-center whitespace-nowrap text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
        variant === "underline"
          ? // -mb-px drops the trigger's 2px rule onto the list's own 1px
            // border so the active rule covers it rather than stacking.
            "-mb-px min-h-11 rounded-sm border-b-2 border-transparent px-0.5 py-2 hover:text-foreground data-[state=active]:border-primary data-[state=active]:text-foreground"
          : "min-h-9 rounded-sm px-3 py-1.5 hover:text-foreground data-[state=active]:bg-surface-1 data-[state=active]:text-foreground data-[state=active]:shadow-elevation-1 hc:data-[state=active]:bg-foreground hc:data-[state=active]:text-background",
        className,
      )}
      {...props}
    />
  );
});
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
