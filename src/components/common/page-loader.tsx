import { LoadingSpinner } from "@/components/common/loading-spinner";
import { AppLogo } from "@/components/brand/app-logo";

interface PageLoaderProps {
  label?: string;
}

/**
 * Full-viewport loading state used while the app bootstraps (auth
 * restoration, route-level Suspense fallbacks, etc.).
 */
export function PageLoader({ label = "Loading..." }: PageLoaderProps) {
  return (
    <div className="relative flex min-h-dvh w-full flex-col items-center justify-center gap-6 bg-black">
      <div
        className="pointer-events-none absolute inset-0 bg-[#141414]"
        aria-hidden="true"
      />
      <AppLogo size="lg" className="relative z-10" />
      <div className="relative z-10 flex items-center gap-2 text-sm text-white/70">
        <LoadingSpinner className="text-white/70" size={16} />
        <span>{label}</span>
      </div>
    </div>
  );
}
