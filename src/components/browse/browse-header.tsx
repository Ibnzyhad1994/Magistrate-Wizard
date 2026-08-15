import type { ReactNode } from "react";
import { BrowseViewSelect } from "@/components/browse/browse-view-select";

interface BrowseHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
  /** Hide the Tiles / List control (e.g. Settings, admin tools). */
  showViewSelect?: boolean;
}

export function BrowseHeader({
  title,
  description,
  action,
  showViewSelect = false,
}: BrowseHeaderProps) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-2xl text-sm text-white/65">{description}</p>
        )}
      </div>
      {(showViewSelect || action) && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {showViewSelect && <BrowseViewSelect />}
          {action}
        </div>
      )}
    </div>
  );
}
