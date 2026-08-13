import { LoadingSpinner } from "@/components/common/loading-spinner";
import { APP_NAME } from "@/lib/constants";

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
      <span className="relative z-10 text-2xl font-extrabold tracking-tight text-primary">
        {APP_NAME}
      </span>
      <div className="relative z-10 flex items-center gap-2 text-sm text-white/70">
        <LoadingSpinner className="text-white/70" size={16} />
        <span>{label}</span>
      </div>
    </div>
  );
}
