import { Outlet } from "react-router-dom";
import { Sidebar } from "@/components/layout/sidebar";
import { MobileNav } from "@/components/layout/mobile-nav";
import { Header } from "@/components/layout/header";

/**
 * Shell for every authenticated route: persistent sidebar on desktop,
 * sheet-based nav + top bar on mobile, and a scrollable content area
 * that routed pages render into via `<Outlet />`.
 */
export function AppLayout() {
  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background">
      <Sidebar />
      <MobileNav />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
