import { Outlet, useLocation } from "react-router-dom";
import { TopNav } from "@/components/layout/top-nav";
import { MobileNav } from "@/components/layout/mobile-nav";
import { CinematicNavProvider } from "@/components/layout/cinematic-nav";
import { OfflineSyncBanner } from "@/components/layout/offline-sync-banner";
import { TourProvider } from "@/components/tour/tour-provider";
import { SessionLifecycle } from "@/components/auth/session-lifecycle";
import { HearingReminderHost } from "@/components/notifications/hearing-reminder-host";
import { RouteAnnouncer } from "@/components/common/route-announcer";

/**
 * Netflix-style shell: fixed top nav over a full-bleed cinematic canvas.
 * Pages own their own horizontal gutter (`browse-gutter` / `BrowsePage`).
 */
export function AppLayout() {
  // Keyed on the path so each route change re-mounts the wrapper and
  // replays the page-in rise. Reduced motion collapses it to a cut.
  const { pathname } = useLocation();
  return (
    <TourProvider>
      <div className="min-h-dvh w-full bg-background">
        {/* WCAG 2.4.1. A magistrate tabs past 14 nav destinations before
          reaching content, an administrator 21 — on every page load.
          Visually hidden until focused, then it appears in place. */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-skip focus:rounded-sm focus:bg-foreground focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-background focus:outline-none focus:ring-2 focus:ring-primary"
        >
          Skip to content
        </a>
        <CinematicNavProvider>
          <TopNav />
          <SessionLifecycle />
          <HearingReminderHost />
          <OfflineSyncBanner />
          <MobileNav />
          <main id="main-content" tabIndex={-1} className="min-h-dvh">
            <div key={pathname} className="animate-page-in">
              <Outlet />
            </div>
          </main>
          <RouteAnnouncer />
        </CinematicNavProvider>
      </div>
    </TourProvider>
  );
}
