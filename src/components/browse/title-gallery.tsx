import type { ReactNode } from "react";

export function TitleGallery({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-3">{children}</div>;
}
