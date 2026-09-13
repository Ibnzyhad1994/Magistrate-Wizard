import { LoadingSpinner } from "@/components/common/loading-spinner";
import { AppLogo } from "@/components/brand/app-logo";
import { AppCanvas } from "@/components/theme/app-canvas";

interface PageLoaderProps {
  label?: string;
}

/**
 * Full-viewport loading state used while the app bootstraps (auth
 * restoration, route-level Suspense fallbacks, etc.).
 */
export function PageLoader({ label = "Loading..." }: PageLoaderProps) {
  return (
    <AppCanvas className="items-center justify-center gap-6">
      <AppLogo size="lg" className="relative z-10" />
      <div className="relative z-10 flex items-center gap-2 text-sm text-foreground/70">
        <LoadingSpinner className="text-foreground/70" size={16} />
        <span>{label}</span>
      </div>
    </AppCanvas>
  );
}
