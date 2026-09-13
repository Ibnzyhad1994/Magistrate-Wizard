import type { ComponentProps } from "react";
import { Toaster as Sonner } from "sonner";
import { useMediaQuery } from "@/hooks/use-media-query";
import { canvasScheme } from "@/lib/theme";
import { useTheme } from "@/providers/use-theme";

type ToasterProps = ComponentProps<typeof Sonner>;

function Toaster({ ...props }: ToasterProps) {
  const { resolvedTheme } = useTheme();
  const isPhone = useMediaQuery("(max-width: 640px)");

  return (
    <Sonner
      theme={canvasScheme(resolvedTheme)}
      className="toaster group"
      position={isPhone ? "bottom-center" : "top-right"}
      offset={isPhone ? 24 : 76}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:rounded-sm group-[.toaster]:border-foreground/10 group-[.toaster]:bg-card group-[.toaster]:text-foreground group-[.toaster]:shadow-none",
          description: "group-[.toast]:text-foreground/65",
          actionButton:
            "group-[.toast]:min-h-9 group-[.toast]:min-w-[7rem] group-[.toast]:bg-primary group-[.toast]:px-3 group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-foreground/10 group-[.toast]:text-foreground/70",
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
