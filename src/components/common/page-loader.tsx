import { LoadingSpinner } from "@/components/common/loading-spinner";
import { Scale } from "lucide-react";

interface PageLoaderProps {
  label?: string;
}

/**
 * Full-viewport loading state used while the app bootstraps (auth
 * restoration, route-level Suspense fallbacks, etc.).
 */
export function PageLoader({ label = "Loading..." }: PageLoaderProps) {
  return (
    <div className="flex min-h-dvh w-full flex-col items-center justify-center gap-4 bg-background">
      <div className="flex items-center gap-2 text-foreground">
        <Scale className="h-6 w-6" aria-hidden="true" />
        <span className="text-lg font-semibold tracking-tight">
          BenchBook
        </span>
      </div>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoadingSpinner size={16} />
        <span>{label}</span>
      </div>
    </div>
  );
}
