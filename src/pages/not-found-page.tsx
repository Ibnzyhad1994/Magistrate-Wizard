import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { AppLogo } from "@/components/brand/app-logo";
import { ROUTES } from "@/routes/paths";

export default function NotFoundPage() {
  return (
    <div className="relative flex min-h-dvh w-full flex-col bg-black">
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden bg-[#141414]"
        aria-hidden="true"
      >
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_#2a2a2a_0%,_#141414_50%,_#000_100%)]" />
        <div className="absolute inset-0 bg-gradient-to-b from-black via-transparent to-black" />
      </div>

      <header className="relative z-10 px-6 py-5 sm:px-12 sm:py-6">
        <Link
          to={ROUTES.dashboard}
          className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <AppLogo size="lg" />
        </Link>
      </header>

      <main className="relative z-10 flex flex-1 flex-col items-center justify-center gap-6 px-6 pb-16 text-center">
        <div className="space-y-3">
          <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
            Lost your way?
          </h1>
          <p className="max-w-md text-base text-white/70">
            The page you&apos;re looking for doesn&apos;t exist or may have
            been moved. You&apos;ll find plenty to explore on the home page.
          </p>
        </div>
        <Button asChild className="h-12 px-8 text-base font-semibold">
          <Link to={ROUTES.dashboard}>Back to dashboard</Link>
        </Button>
      </main>
    </div>
  );
}
