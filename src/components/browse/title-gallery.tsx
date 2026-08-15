import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/store/ui-store";

export function TitleGallery({ children }: { children: ReactNode }) {
  const browseView = useUiStore((s) => s.browseView);

  return (
    <div
      className={cn(
        browseView === "list"
          ? "flex flex-col gap-1.5 [&>*]:w-full"
          : "flex flex-wrap gap-2",
      )}
    >
      {children}
    </div>
  );
}
