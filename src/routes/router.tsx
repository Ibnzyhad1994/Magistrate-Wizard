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
import JudgmentListPage from "@/pages/judgments/judgment-list-page";
import JudgmentDetailPage from "@/pages/judgments/judgment-detail-page";
import CaseLawListPage from "@/pages/case-law/case-law-list-page";
import CaseLawDetailPage from "@/pages/case-law/case-law-detail-page";
import LegislationListPage from "@/pages/legislation/legislation-list-page";
import LegislationDetailPage from "@/pages/legislation/legislation-detail-page";
import QuickCodesPage from "@/pages/quick-codes/quick-codes-page";
import BenchNotesListPage from "@/pages/bench-notes/bench-notes-list-page";
import BenchNoteDetailPage from "@/pages/bench-notes/bench-note-detail-page";
import BookmarksPage from "@/pages/bookmarks/bookmarks-page";
import SearchPage from "@/pages/search/search-page";
import CalendarPage from "@/pages/calendar/calendar-page";
import SettingsPage from "@/pages/settings/settings-page";
import CourtAssignmentsPage from "@/pages/admin/court-assignments-page";
import LegalLibraryAdminPage from "@/pages/admin/legal-library-admin-page";
import ClerkAccessAdminPage from "@/pages/admin/clerk-access-admin-page";
import ClerkAccessPage from "@/pages/clerk/clerk-access-page";
import ClerkAccessRequestsPage from "@/pages/clerk/clerk-access-requests-page";
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
    // Available to any signed-in role, any clerk approval status — a
    // pending clerk must still be able to reach their home screen,
    // account settings, and their own access-request page.
    element: <ProtectedRoute />,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: ROUTES.home, element: <Navigate to={ROUTES.dashboard} replace /> },
          { path: ROUTES.dashboard, element: <DashboardPage /> },
          { path: ROUTES.settings, element: <SettingsPage /> },
          { path: ROUTES.clerkAccess, element: <ClerkAccessPage /> },
        ],
      },
    ],
  },
  {
    // Docket: deliberately NOT role-restricted. Whole-court access is
    // governed by court ASSIGNMENT (magistrate_courts / approved
    // clerk_courts), not by platform role — an admin who also holds an
    // active magistrate_courts row must reach this route exactly like a
    // magistrate does, and matter-specific retained/shared access must
    // keep working regardless of role too. An `allowedRoles` allowlist
    // here previously excluded 'admin', which silently blocked an
    // admin-who-is-also-a-magistrate from the Docket even though their
    // magistrate_courts assignments were fully intact — see 0097-era
    // regression notes. RLS (can_access_court, has_retained_assignment,
    // has_docket_share, has_active_clerk_assignment) remains the actual
    // authorization boundary underneath; the Docket page itself already
    // shows an accurate "no current Court assignment" message rather
    // than pretending access when a signed-in user has none of the four
    // pathways below. A clerk additionally needs at least one
    // currently-active clerk_courts assignment — enforced here (not by
    // role restriction) so a pending clerk is redirected to the
    // pending-access experience rather than briefly rendering (or
    // fetching) any docket content; a no-op for every other role.
    element: <ProtectedRoute requireApprovedClerkCourt />,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: ROUTES.docket, element: <DocketListPage /> },
          { path: "/docket/:id", element: <DocketMatterDetailPage /> },
        ],
      },
    ],
  },
  {
    // Case Law, Judgments, Legislation, and the other research/workbench
    // areas are magistrate-only content — a clerk role never satisfies
    // allowedRoles here, regardless of any docket court assignment.
    element: <ProtectedRoute allowedRoles={["magistrate", "admin"]} />,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: ROUTES.judgments, element: <JudgmentListPage /> },
          { path: "/judgments/:id", element: <JudgmentDetailPage /> },
          { path: ROUTES.caseLaw, element: <CaseLawListPage /> },
          { path: "/case-law/:id", element: <CaseLawDetailPage /> },
          { path: ROUTES.legislation, element: <LegislationListPage /> },
          { path: "/legislation/:id", element: <LegislationDetailPage /> },
          { path: "/legislation/:id/section/:provisionId", element: <LegislationDetailPage /> },
          { path: ROUTES.quickCodes, element: <QuickCodesPage /> },
          { path: ROUTES.benchNotes, element: <BenchNotesListPage /> },
          { path: "/bench-notes/:id", element: <BenchNoteDetailPage /> },
          { path: ROUTES.bookmarks, element: <BookmarksPage /> },
          { path: ROUTES.search, element: <SearchPage /> },
          { path: ROUTES.calendar, element: <CalendarPage /> },
          { path: ROUTES.clerkAccessRequests, element: <ClerkAccessRequestsPage /> },
        ],
      },
    ],
  },
  {
    element: <ProtectedRoute allowedRoles={["admin"]} />,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: ROUTES.adminCourtAssignments, element: <CourtAssignmentsPage /> },
          { path: ROUTES.adminLegalLibrary, element: <LegalLibraryAdminPage /> },
          { path: ROUTES.adminClerkAccess, element: <ClerkAccessAdminPage /> },
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
