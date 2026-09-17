import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { AppLogo } from "@/components/brand/app-logo";
import { AuthSplash } from "@/components/brand/auth-splash";
import { shouldPlayAuthSplash } from "@/lib/auth-splash";
import { AppCanvas } from "@/components/theme/app-canvas";
import { RouteAnnouncer } from "@/components/common/route-announcer";
import { ROUTES } from "@/routes/paths";
import { cn } from "@/lib/utils";

const SPLASH_ROUTES = new Set<string>([ROUTES.login, ROUTES.register]);

/**
 * Public/unauthenticated shell (login, register, forgot password).
 * Logo top-left, no chrome. Theme follows the saved choice; the picker
 * lives in Settings and the account menu after sign-in. The form panel
 * itself lives in the page. Sign In and Sign Up open with a brand splash;
 * forgot/reset password skip it so recovery stays immediate.
 */
export function AuthLayout() {
  const { pathname } = useLocation();
  const wantsSplash = SPLASH_ROUTES.has(pathname);
  const [showSplash, setShowSplash] = useState(() => wantsSplash && shouldPlayAuthSplash());

  useEffect(() => {
    setShowSplash(wantsSplash && shouldPlayAuthSplash());
  }, [wantsSplash]);

  const continueLabel =
    pathname === ROUTES.register ? "Continue to create an account" : "Continue to sign in";

  return (
    <AppCanvas className={showSplash ? "h-dvh overflow-hidden" : undefined}>
      {showSplash ? (
        <AuthSplash continueLabel={continueLabel} onDismissed={() => setShowSplash(false)} />
      ) : null}

      <header
        className={cn(
          "relative z-10 px-6 pb-5 pt-[calc(1.25rem+env(safe-area-inset-top,0px))] sm:px-12 sm:pb-6 sm:pt-[calc(1.5rem+env(safe-area-inset-top,0px))]",
          showSplash && "invisible",
        )}
      >
        <AppLogo size="lg" />
      </header>

      <main
        id="main-content"
        tabIndex={-1}
        className="relative z-10 flex flex-1 items-center justify-center px-4 py-8"
      >
        <div className="w-full max-w-[450px]">
          <Outlet />
        </div>
      </main>
      <RouteAnnouncer />
    </AppCanvas>
  );
}
