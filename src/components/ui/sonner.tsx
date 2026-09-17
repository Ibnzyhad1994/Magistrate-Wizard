import type { ComponentProps } from "react";
import { Toaster as Sonner } from "sonner";
import { useMediaQuery } from "@/hooks/use-media-query";
import { canvasScheme } from "@/lib/theme";
import { useTheme } from "@/providers/use-theme";

type ToasterProps = ComponentProps<typeof Sonner>;

/**
 * Toasts share the card surface; the kind is carried by a 2px left edge in
 * the semantic colour (destructive / success / warning / info) so an error
 * is distinguishable from a confirmation at a glance and in every palette,
 * including colourblind-safe where amber and green are retuned.
 */
function Toaster({ ...props }: ToasterProps) {
  const { resolvedTheme } = useTheme();
  const isPhone = useMediaQuery("(max-width: 640px)");

  return (
    <Sonner
      theme={canvasScheme(resolvedTheme)}
      className="toaster group"
      position={isPhone ? "bottom-center" : "top-right"}
      offset={isPhone ? 24 : 76}
      closeButton
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:rounded-sm group-[.toaster]:border-border group-[.toaster]:bg-card group-[.toaster]:text-foreground group-[.toaster]:shadow-none",
          error: "group-[.toaster]:border-l-2 group-[.toaster]:border-l-destructive",
          success: "group-[.toaster]:border-l-2 group-[.toaster]:border-l-success",
          warning: "group-[.toaster]:border-l-2 group-[.toaster]:border-l-warning",
          info: "group-[.toaster]:border-l-2 group-[.toaster]:border-l-info",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:min-h-9 group-[.toast]:min-w-[7rem] group-[.toast]:bg-primary group-[.toast]:px-3 group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-foreground/10 group-[.toast]:text-foreground/70",
          closeButton:
            "group-[.toast]:border-border group-[.toast]:bg-card group-[.toast]:text-foreground",
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
