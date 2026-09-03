import { Outlet } from "react-router-dom";
import { TopNav } from "@/components/layout/top-nav";
import { MobileNav } from "@/components/layout/mobile-nav";
import { OfflineSyncBanner } from "@/components/layout/offline-sync-banner";
import { TourProvider } from "@/components/tour/tour-provider";
import { SessionLifecycle } from "@/components/auth/session-lifecycle";
import { HearingReminderHost } from "@/components/notifications/hearing-reminder-host";

/**
 * Netflix-style shell: fixed top nav over a full-bleed cinematic canvas.
 * Pages own their own horizontal gutter (`browse-gutter` / `BrowsePage`).
 */
export function AppLayout() {
  return (
    <TourProvider>
    <div className="min-h-dvh w-full bg-[#141414]">
      <TopNav />
      <SessionLifecycle />
      <HearingReminderHost />
      <OfflineSyncBanner />
      <MobileNav />
      <main className="min-h-dvh">
        <Outlet />
      </main>
    </div>
    </TourProvider>
  );
}
