import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuthStore } from "@/store/auth-store";
import { ROUTES } from "@/routes/paths";
import { PageLoader } from "@/components/common/page-loader";
import { pathFromLoginRedirect } from "@/lib/auth/session-policy";

interface LocationState {
  from?: { pathname: string; search?: string; hash?: string };
}

/**
 * Gate for routes that should only be visible to signed-out visitors
 * (login, register, forgot password). Already-authenticated users are
 * redirected to their originally requested page, or the dashboard.
 */
export function PublicRoute() {
  const status = useAuthStore((state) => state.status);
  const location = useLocation();

  if (status === "loading") {
    return <PageLoader />;
  }

  if (status === "authenticated" || status === "locked") {
    const state = location.state as LocationState | null;
    const redirectTo = pathFromLoginRedirect(state?.from, ROUTES.dashboard);
    return <Navigate to={redirectTo} replace />;
  }

  return <Outlet />;
}
