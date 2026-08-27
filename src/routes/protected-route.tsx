import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuthStore } from "@/store/auth-store";
import { ROUTES } from "@/routes/paths";
import type { UserRole } from "@/lib/constants";
import { PageLoader } from "@/components/common/page-loader";
import { resolveProtectedRouteGate } from "@/lib/protected-route-gate";
import { useHasApprovedClerkCourt } from "@/hooks/clerk/use-clerk-access";

interface ProtectedRouteProps {
  /**
   * If provided, the signed-in user's profile role must be one of these
   * to render the route. Otherwise they're redirected to /unauthorized.
   */
  allowedRoles?: UserRole[];
  /**
   * Docket routes only: a clerk must additionally have at least one
   * currently-active clerk_courts assignment. A pending clerk (verified,
   * zero approved courts yet) is redirected to /clerk-access instead of
   * /unauthorized — they aren't forbidden, they're just not ready yet.
   * No-op for every other role.
   */
  requireApprovedClerkCourt?: boolean;
}

/**
 * Gate for authenticated-only routes. Renders a nested <Outlet /> when the
 * user is signed in (and, if `allowedRoles` is set, authorized); otherwise
 * redirects to /login, preserving the attempted location for post-login
 * redirect.
 */
export function ProtectedRoute({ allowedRoles, requireApprovedClerkCourt }: ProtectedRouteProps) {
  const status = useAuthStore((state) => state.status);
  const profile = useAuthStore((state) => state.profile);
  const location = useLocation();
  const { data: hasApprovedClerkCourt } = useHasApprovedClerkCourt();
  const gate = resolveProtectedRouteGate({
    status,
    profile,
    allowedRoles,
    requireApprovedClerkCourt,
    hasApprovedClerkCourt,
  });

  if (gate === "loading") {
    return <PageLoader />;
  }

  if (gate === "login") {
    return (
      <Navigate to={ROUTES.login} state={{ from: location }} replace />
    );
  }

  if (gate === "unauthorized") {
    return <Navigate to={ROUTES.unauthorized} replace />;
  }

  if (gate === "pending-clerk") {
    return <Navigate to={ROUTES.clerkAccess} replace />;
  }

  return <Outlet />;
}
