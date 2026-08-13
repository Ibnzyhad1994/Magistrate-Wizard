import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";
import { hScrollMask, useHScroll } from "@/hooks/use-h-scroll";

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => {
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
        "flex h-auto min-h-10 w-full max-w-full items-center justify-start gap-0.5 overflow-x-auto overscroll-x-contain scroll-smooth scrollbar-none rounded-sm border border-white/10 bg-[#181818] p-0.5 text-white/60",
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
        "inline-flex min-h-10 shrink-0 items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-white/10 data-[state=active]:text-white data-[state=active]:shadow-none",
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
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
