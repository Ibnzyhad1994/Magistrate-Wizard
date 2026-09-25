import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { AppLogo } from "@/components/brand/app-logo";
import { AppCanvas } from "@/components/theme/app-canvas";
import { ROUTES } from "@/routes/paths";
import { usePageTitle } from "@/hooks/use-page-title";

export default function UnauthorizedPage() {
  usePageTitle("Not authorised");
  return (
    <AppCanvas>
      <header className="relative z-10 px-6 py-5 sm:px-12 sm:py-6">
        <Link
          to={ROUTES.home}
          className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <AppLogo size="lg" />
        </Link>
      </header>

      <main className="relative z-10 flex flex-1 flex-col items-center justify-center gap-6 px-6 pb-16 text-center">
        <div className="space-y-3">
          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            You don&apos;t have access
          </h1>
          <p className="max-w-md text-base text-foreground/70">
            Your account can&apos;t open this page. Ask your administrator if you think it should.
          </p>
        </div>
        <Button asChild className="h-12 px-8 text-base font-semibold">
          <Link to={ROUTES.home}>Back to home</Link>
        </Button>
      </main>
    </AppCanvas>
  );
}
