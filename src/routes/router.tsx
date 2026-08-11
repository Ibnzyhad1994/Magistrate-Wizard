import { createBrowserRouter, Navigate } from "react-router-dom";
import { ROUTES } from "@/routes/paths";
import { ProtectedRoute } from "@/routes/protected-route";
import { PublicRoute } from "@/routes/public-route";
import { AppLayout } from "@/layouts/app-layout";
import { AuthLayout } from "@/layouts/auth-layout";
import { RouteErrorBoundary } from "@/components/common/error-boundary";
import LoginPage from "@/pages/auth/login-page";
import RegisterPage from "@/pages/auth/register-page";
import ForgotPasswordPage from "@/pages/auth/forgot-password-page";
import DashboardPage from "@/pages/dashboard-page";
import DocketListPage from "@/pages/docket/docket-list-page";
import DocketMatterDetailPage from "@/pages/docket/docket-matter-detail-page";
import NotFoundPage from "@/pages/not-found-page";
import UnauthorizedPage from "@/pages/unauthorized-page";

export const router = createBrowserRouter([
  {
    element: <PublicRoute />,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        element: <AuthLayout />,
        children: [
          { path: ROUTES.login, element: <LoginPage /> },
          { path: ROUTES.register, element: <RegisterPage /> },
          { path: ROUTES.forgotPassword, element: <ForgotPasswordPage /> },
        ],
      },
    ],
  },
  {
    element: <ProtectedRoute />,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: ROUTES.home, element: <Navigate to={ROUTES.dashboard} replace /> },
          { path: ROUTES.dashboard, element: <DashboardPage /> },
          { path: ROUTES.docket, element: <DocketListPage /> },
          { path: "/docket/:id", element: <DocketMatterDetailPage /> },
        ],
      },
    ],
  },
  {
    path: ROUTES.unauthorized,
    element: <UnauthorizedPage />,
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: ROUTES.notFound,
    element: <NotFoundPage />,
    errorElement: <RouteErrorBoundary />,
  },
]);
