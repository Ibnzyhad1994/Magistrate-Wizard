import { Outlet } from "react-router-dom";
import { AppLogo } from "@/components/brand/app-logo";

/**
 * Public/unauthenticated shell (login, register, forgot password).
 * Netflix web login: full-bleed cinematic canvas, red wordmark top-left,
 * no sidebar, no chrome. The form panel itself lives in the page.
 */
export function AuthLayout() {
  return (
    <div className="relative flex min-h-dvh w-full flex-col bg-black">
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden bg-[#141414]"
        aria-hidden="true"
      >
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_#2a2a2a_0%,_#141414_50%,_#000_100%)]" />
        <div className="absolute inset-0 bg-gradient-to-b from-black via-transparent to-black" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-transparent to-black/80" />
      </div>

      <header className="relative z-10 px-6 py-5 sm:px-12 sm:py-6">
        <AppLogo size="lg" />
      </header>

      <main className="relative z-10 flex flex-1 items-center justify-center px-4 py-8">
        <div className="w-full max-w-[450px]">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
