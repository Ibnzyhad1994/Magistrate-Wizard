import { Outlet } from "react-router-dom";
import { TopNav } from "@/components/layout/top-nav";
import { MobileNav } from "@/components/layout/mobile-nav";

/**
 * Netflix-style shell: fixed top nav over a full-bleed cinematic canvas.
 * Pages own their own horizontal gutter (`browse-gutter` / `BrowsePage`).
 */
export function AppLayout() {
  return (
    <div className="min-h-dvh w-full bg-[#141414]">
      <TopNav />
      <MobileNav />
      <main className="min-h-dvh">
        <Outlet />
      </main>
    </div>
  );
}
