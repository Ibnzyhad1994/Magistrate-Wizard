import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { ROLE_LABELS, type UserRole } from "@/lib/constants";

/**
 * Placeholder landing page for authenticated users. This is intentionally
 * a shell — case research, bench notes, and other feature areas land in
 * later phases and will replace/extend this page.
 */
export default function DashboardPage() {
  const { profile, user } = useAuth();
  const displayName = profile?.full_name ?? user?.email ?? "there";
  const role = profile?.role as UserRole | undefined;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          Welcome, {displayName}
        </h2>
        <p className="text-sm text-muted-foreground">
          {role
            ? `Signed in as ${ROLE_LABELS[role]}.`
            : "Your BenchBook workspace."}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Foundation ready</CardTitle>
          <CardDescription>
            Authentication, routing, and the app shell are wired up. Feature
            areas will be built here in upcoming phases.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          This dashboard will be replaced with real content as BenchBook's
          case research, bench notes, and reference modules are built out.
        </CardContent>
      </Card>
    </div>
  );
}
