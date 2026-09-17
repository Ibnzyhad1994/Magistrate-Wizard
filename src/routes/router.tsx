import { Suspense, lazy, type ComponentType } from "react";
import { createBrowserRouter } from "react-router-dom";
import { ROUTES } from "@/routes/paths";
import { ProtectedRoute } from "@/routes/protected-route";
import { PublicRoute } from "@/routes/public-route";
import { AppLayout } from "@/layouts/app-layout";
import { AuthLayout } from "@/layouts/auth-layout";
import { RouteErrorBoundary } from "@/components/common/error-boundary";
import { LoadingRegion } from "@/components/common/loading-region";
import { LoadingSpinner } from "@/components/common/loading-spinner";

/**
 * Every page is a separate chunk. Before this, router.tsx statically
 * imported all 38 pages, so a clerk downloaded TipTap, jsPDF, the admin
 * consoles and the legislation viewer before seeing the login form. Each
 * page module keeps its default export; `page()` wraps it in React.lazy
 * plus a Suspense boundary so a chunk fetch shows a spinner in the layout
 * rather than blanking the shell. RouteErrorBoundary (per branch below)
 * already catches a failed chunk load the same way it catches a render
 * error.
 *
 * scripts/tests/test-lazy-routes.mjs asserts no static page import creeps
 * back in here.
 */
const routeFallback = (
  <LoadingRegion label="Loading page" className="flex min-h-[40vh] items-center justify-center">
    <LoadingSpinner />
  </LoadingRegion>
);

function page(load: () => Promise<{ default: ComponentType }>) {
  const Page = lazy(load);
  return (
    <Suspense fallback={routeFallback}>
      <Page />
    </Suspense>
  );
}

export const router = createBrowserRouter([
  {
    element: <PublicRoute />,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        element: <AuthLayout />,
        children: [
          { path: ROUTES.login, element: page(() => import("@/pages/auth/login-page")) },
          { path: ROUTES.register, element: page(() => import("@/pages/auth/register-page")) },
          {
            path: ROUTES.forgotPassword,
            element: page(() => import("@/pages/auth/forgot-password-page")),
          },
          {
            path: ROUTES.resetPassword,
            element: page(() => import("@/pages/auth/reset-password-page")),
          },
        ],
      },
    ],
  },
  {
    // Available to any signed-in role, any clerk/magistrate approval
    // status — a pending clerk or magistrate must still be able to reach
    // their own access/assignment-request page. Settings and Notifications
    // live here too: a pending magistrate needs to change their password,
    // pick a theme and read the notice that says their request was
    // approved or rejected, exactly as a pending clerk already could. The
    // "full suite" (Home, Dashboard, Docket, research areas) remains
    // gated on an approved court in the blocks below.
    element: <ProtectedRoute />,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        element: <AppLayout />,
        children: [
          {
            path: ROUTES.clerkAccess,
            element: page(() => import("@/pages/clerk/clerk-access-page")),
          },
          {
            path: ROUTES.courtAssignments,
            element: page(() => import("@/pages/court-assignments/court-assignments-page")),
          },
          { path: ROUTES.settings, element: page(() => import("@/pages/settings/settings-page")) },
          {
            path: ROUTES.notifications,
            element: page(() => import("@/pages/notifications/notifications-page")),
          },
        ],
      },
    ],
  },
  {
    // Home/Dashboard: any signed-in role, but a pending magistrate (zero
    // currently-active magistrate_courts assignments — brand new signup,
    // awaiting review, or rejected) is redirected to /court-assignments
    // instead — the full application is contingent on an approved court,
    // not merely on having an account. No-op for clerk/admin.
    element: <ProtectedRoute requireApprovedMagistrateCourt />,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: ROUTES.home, element: page(() => import("@/pages/home-page")) },
          { path: ROUTES.dashboard, element: page(() => import("@/pages/dashboard-page")) },
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
          { path: ROUTES.docket, element: page(() => import("@/pages/docket/docket-list-page")) },
          { path: ROUTES.docketBin, element: page(() => import("@/pages/docket/docket-bin-page")) },
          // Static segment, so it outranks `/docket/:id` below exactly
          // as `/docket/bin` already does. Callovers themselves live in
          // the magistrate-only block further down — can_access_callover()
          // (0129) has no clerk path, unlike this block's own gate.
          {
            path: "/docket/:id",
            element: page(() => import("@/pages/docket/docket-matter-detail-page")),
          },
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
    element: (
      <ProtectedRoute allowedRoles={["magistrate", "admin"]} requireApprovedMagistrateCourt />
    ),
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        element: <AppLayout />,
        children: [
          {
            path: ROUTES.callovers,
            element: page(() => import("@/pages/docket/callover/callover-list-page")),
          },
          {
            path: "/docket/callovers/:id",
            element: page(() => import("@/pages/docket/callover/callover-detail-page")),
          },
          {
            path: ROUTES.judgments,
            element: page(() => import("@/pages/judgments/judgment-list-page")),
          },
          {
            path: "/judgments/:id",
            element: page(() => import("@/pages/judgments/judgment-detail-page")),
          },
          {
            path: ROUTES.caseLaw,
            element: page(() => import("@/pages/case-law/case-law-list-page")),
          },
          {
            path: "/case-law/:id",
            element: page(() => import("@/pages/case-law/case-law-detail-page")),
          },
          {
            path: ROUTES.legislation,
            element: page(() => import("@/pages/legislation/legislation-list-page")),
          },
          // Read-only. Editing lives on a SEPARATE, admin-gated route below
          // (ROUTES.legislationEdit) — never mounted here.
          {
            path: "/legislation/:id",
            element: page(() => import("@/pages/legislation/legislation-viewer-page")),
          },
          {
            path: "/legislation/:id/section/:provisionId",
            element: page(() => import("@/pages/legislation/legislation-viewer-page")),
          },
          {
            path: ROUTES.quickCodes,
            element: page(() => import("@/pages/quick-codes/quick-codes-page")),
          },
          {
            path: ROUTES.benchNotes,
            element: page(() => import("@/pages/bench-notes/bench-notes-list-page")),
          },
          {
            path: "/bench-notes/:id",
            element: page(() => import("@/pages/bench-notes/bench-note-detail-page")),
          },
          {
            path: ROUTES.bookmarks,
            element: page(() => import("@/pages/bookmarks/bookmarks-page")),
          },
          { path: ROUTES.search, element: page(() => import("@/pages/search/search-page")) },
          { path: ROUTES.calendar, element: page(() => import("@/pages/calendar/calendar-page")) },
          {
            path: ROUTES.clerkAccessRequests,
            element: page(() => import("@/pages/clerk/clerk-access-requests-page")),
          },
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
          {
            path: ROUTES.adminCourtAssignments,
            element: page(() => import("@/pages/admin/court-assignments-page")),
          },
          {
            path: ROUTES.adminLegalLibrary,
            element: page(() => import("@/pages/admin/legal-library-admin-page")),
          },
          {
            path: ROUTES.adminClerkAccess,
            element: page(() => import("@/pages/admin/clerk-access-admin-page")),
          },
          {
            path: ROUTES.adminIssueReports,
            element: page(() => import("@/pages/admin/issue-reports-admin-page")),
          },
          {
            path: ROUTES.adminActivity,
            element: page(() => import("@/pages/admin/audit-activity-admin-page")),
          },
          {
            path: ROUTES.adminPeople,
            element: page(() => import("@/pages/admin/people-admin-page")),
          },
          {
            path: ROUTES.adminOperations,
            element: page(() => import("@/pages/admin/operations-admin-page")),
          },
          {
            path: "/legislation/:id/edit",
            element: page(() => import("@/pages/legislation/legislation-edit-page")),
          },
        ],
      },
    ],
  },
  {
    path: ROUTES.unauthorized,
    element: page(() => import("@/pages/unauthorized-page")),
    errorElement: <RouteErrorBoundary />,
  },
  {
    path: ROUTES.notFound,
    element: page(() => import("@/pages/not-found-page")),
    errorElement: <RouteErrorBoundary />,
  },
]);
