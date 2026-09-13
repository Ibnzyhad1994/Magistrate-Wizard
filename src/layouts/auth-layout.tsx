import { Outlet } from "react-router-dom";
import { AppLogo } from "@/components/brand/app-logo";
import { AppCanvas } from "@/components/theme/app-canvas";

/**
 * Public/unauthenticated shell (login, register, forgot password).
 * Logo top-left, no chrome. Theme follows the saved choice; the picker
 * lives in Settings and the account menu after sign-in. The form panel
 * itself lives in the page.
 */
export function AuthLayout() {
  return (
    <AppCanvas>
      <header className="relative z-10 px-6 pt-[calc(1.25rem+env(safe-area-inset-top,0px))] pb-5 sm:px-12 sm:pt-[calc(1.5rem+env(safe-area-inset-top,0px))] sm:pb-6">
        <AppLogo size="lg" />
      </header>

      <main className="relative z-10 flex flex-1 items-center justify-center px-4 py-8">
        <div className="w-full max-w-[450px]">
          <Outlet />
        </div>
      </main>
    </AppCanvas>
  );
}
