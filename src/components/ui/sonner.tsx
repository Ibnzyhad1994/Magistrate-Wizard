import type { ComponentProps } from "react";
import { Toaster as Sonner } from "sonner";
import { useTheme } from "@/providers/theme-provider";

type ToasterProps = ComponentProps<typeof Sonner>;

function Toaster({ ...props }: ToasterProps) {
  const { resolvedTheme } = useTheme();

  return (
    <Sonner
      theme={resolvedTheme}
      className="toaster group"
      position="top-right"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:rounded-sm group-[.toaster]:border-white/10 group-[.toaster]:bg-[#181818] group-[.toaster]:text-white group-[.toaster]:shadow-none",
          description: "group-[.toast]:text-white/65",
          actionButton:
            "group-[.toast]:min-h-9 group-[.toast]:min-w-[7rem] group-[.toast]:bg-primary group-[.toast]:px-3 group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-white/10 group-[.toast]:text-white/70",
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
