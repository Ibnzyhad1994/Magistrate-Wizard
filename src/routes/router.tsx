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
import LegislationViewerPage from "@/pages/legislation/legislation-viewer-page";
import LegislationEditPage from "@/pages/legislation/legislation-edit-page";
import QuickCodesPage from "@/pages/quick-codes/quick-codes-page";
import BenchNotesListPage from "@/pages/bench-notes/bench-notes-list-page";
import BenchNoteDetailPage from "@/pages/bench-notes/bench-note-detail-page";
import BookmarksPage from "@/pages/bookmarks/bookmarks-page";
import SearchPage from "@/pages/search/search-page";
import CalendarPage from "@/pages/calendar/calendar-page";
import SettingsPage from "@/pages/settings/settings-page";
import AdminCourtAssignmentsPage from "@/pages/admin/court-assignments-page";
import CourtAssignmentsPage from "@/pages/court-assignments/court-assignments-page";
import LegalLibraryAdminPage from "@/pages/admin/legal-library-admin-page";
import ClerkAccessAdminPage from "@/pages/admin/clerk-access-admin-page";
import IssueReportsAdminPage from "@/pages/admin/issue-reports-admin-page";
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
    // Available to any signed-in role, any clerk/magistrate approval
    // status — a pending clerk or magistrate must still be able to reach
    // their own access/assignment-request page. A pending MAGISTRATE is
    // deliberately NOT given Dashboard/Settings here (unlike a pending
    // clerk) — see the requireApprovedMagistrateCourt block below for
    // why: "only able to access a part of the application that tells
    // them the status of their application request" is intentionally
    // stricter than the existing pending-clerk experience.
    element: <ProtectedRoute />,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: ROUTES.clerkAccess, element: <ClerkAccessPage /> },
          { path: ROUTES.courtAssignments, element: <CourtAssignmentsPage /> },
        ],
      },
    ],
  },
  {
    // Dashboard/Settings: any signed-in role, but a pending magistrate
    // (zero currently-active magistrate_courts assignments — brand new
    // signup, awaiting review, or rejected) is redirected to
    // /court-assignments instead — the full application is contingent on
    // an approved court, not merely on having an account. No-op for
    // clerk/admin.
    element: <ProtectedRoute requireApprovedMagistrateCourt />,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: ROUTES.home, element: <Navigate to={ROUTES.dashboard} replace /> },
          { path: ROUTES.dashboard, element: <DashboardPage /> },
          { path: ROUTES.settings, element: <SettingsPage /> },
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
    // currently-active clerk_courts assignment, and a magistrate at
    // least one currently-active magistrate_courts assignment — both
    // enforced here (not by role restriction) so a pending clerk or
    // magistrate is redirected to their own pending-access experience
    // rather than briefly rendering (or fetching) any docket content;
    // a no-op for admin.
    element: <ProtectedRoute requireApprovedClerkCourt requireApprovedMagistrateCourt />,
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
    // allowedRoles here, regardless of any docket court assignment. A
    // pending magistrate (zero currently-active magistrate_courts
    // assignments) is additionally redirected to /court-assignments —
    // this is the "full suite" the user's own approved court unlocks.
    element: <ProtectedRoute allowedRoles={["magistrate", "admin"]} requireApprovedMagistrateCourt />,
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
          // Read-only. Editing lives on a SEPARATE, admin-gated route below
          // (ROUTES.legislationEdit) — never mounted here.
          { path: "/legislation/:id", element: <LegislationViewerPage /> },
          { path: "/legislation/:id/section/:provisionId", element: <LegislationViewerPage /> },
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
    // Admin-only. Legislation editing (ROUTES.legislationEdit) lives here
    // rather than in the magistrate+admin Legislation block above —
    // "editing must be a separate, deliberate, permission-controlled
    // action," enforced at the route layer as the first line of defense.
    // A magistrate or clerk directly navigating to /legislation/:id/edit
    // is redirected to /unauthorized before LegislationEditPage ever
    // mounts. RLS (statutes UPDATE/DELETE, documents INSERT for
    // entity_type='statute', finalize_legislation_document) is the real,
    // independent boundary underneath regardless of this route guard.
    element: <ProtectedRoute allowedRoles={["admin"]} />,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: ROUTES.adminCourtAssignments, element: <AdminCourtAssignmentsPage /> },
          { path: ROUTES.adminLegalLibrary, element: <LegalLibraryAdminPage /> },
          { path: ROUTES.adminClerkAccess, element: <ClerkAccessAdminPage /> },
          { path: ROUTES.adminIssueReports, element: <IssueReportsAdminPage /> },
          { path: "/legislation/:id/edit", element: <LegislationEditPage /> },
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
