import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuthStore } from "@/store/auth-store";
import { ROUTES } from "@/routes/paths";
import type { UserRole } from "@/lib/constants";
import { PageLoader } from "@/components/common/page-loader";

interface ProtectedRouteProps {
  /**
   * If provided, the signed-in user's profile role must be one of these
   * to render the route. Otherwise they're redirected to /unauthorized.
   */
  allowedRoles?: UserRole[];
}

/**
 * Gate for authenticated-only routes. Renders a nested <Outlet /> when the
 * user is signed in (and, if `allowedRoles` is set, authorized); otherwise
 * redirects to /login, preserving the attempted location for post-login
 * redirect.
 */
export function ProtectedRoute({ allowedRoles }: ProtectedRouteProps) {
  const status = useAuthStore((state) => state.status);
  const profile = useAuthStore((state) => state.profile);
  const location = useLocation();

  if (status === "loading") {
    return <PageLoader />;
  }

  if (status === "unauthenticated") {
    return (
      <Navigate to={ROUTES.login} state={{ from: location }} replace />
    );
  }

  if (allowedRoles && allowedRoles.length > 0) {
    const role = profile?.role;
    if (!role || !allowedRoles.includes(role)) {
      return <Navigate to={ROUTES.unauthorized} replace />;
    }
  }

  return <Outlet />;
}
