import type { ReactNode } from "react";

interface BrowseHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function BrowseHeader({ title, description, action }: BrowseHeaderProps) {
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
      {action}
    </div>
  );
}
