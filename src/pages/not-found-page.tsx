import { Link } from "react-router-dom";
import { FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/routes/paths";

export default function NotFoundPage() {
  return (
    <div className="flex min-h-dvh w-full flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <FileQuestion className="h-6 w-6" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <h1 className="text-lg font-semibold text-foreground">
          Page not found
        </h1>
        <p className="max-w-md text-sm text-muted-foreground">
          The page you&apos;re looking for doesn&apos;t exist or may have
          been moved.
        </p>
      </div>
      <Button asChild>
        <Link to={ROUTES.dashboard}>Back to dashboard</Link>
      </Button>
    </div>
  );
}
