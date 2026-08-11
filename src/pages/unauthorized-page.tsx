import { Link } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/routes/paths";

export default function UnauthorizedPage() {
  return (
    <div className="flex min-h-dvh w-full flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <ShieldAlert className="h-6 w-6" aria-hidden="true" />
      </div>
      <div className="space-y-1">
        <h1 className="text-lg font-semibold text-foreground">
          You don&apos;t have access to this page
        </h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Your account role doesn&apos;t have permission to view this
          resource. Contact your administrator if you believe this is a
          mistake.
        </p>
      </div>
      <Button asChild>
        <Link to={ROUTES.dashboard}>Back to dashboard</Link>
      </Button>
    </div>
  );
}
