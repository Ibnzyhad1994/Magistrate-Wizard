import { useNavigate } from "react-router-dom";
import { Gavel, ArrowRight } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { InlineError } from "@/components/common/inline-error";
import { useAuth } from "@/hooks/use-auth";
import { useDocketMatters } from "@/hooks/docket/use-docket-matters";
import { ROLE_LABELS, type UserRole } from "@/lib/constants";
import { ROUTES } from "@/routes/paths";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  active: "default",
  stayed: "secondary",
  completed: "outline",
  archived: "outline",
};

/**
 * Deliberately restrained: only shows the signed-in user's own
 * RLS-filtered Docket view (same query as the Docket list page), never a
 * global/cross-user count that would leak the existence of matters the
 * user cannot otherwise access.
 */
export default function DashboardPage() {
  const { profile, user } = useAuth();
  const navigate = useNavigate();
  const displayName = profile?.full_name ?? user?.email ?? "there";
  const role = profile?.role as UserRole | undefined;
  const { data, isPending, isError, error, refetch } = useDocketMatters("");
  const recent = data?.slice(0, 5) ?? [];

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
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Your Docket</CardTitle>
            <CardDescription>
              Matters assigned to your Court, retained, or shared with you.
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={() => navigate(ROUTES.docket)}>
            View all
            <ArrowRight className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent>
          {isPending ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : isError ? (
            <InlineError error={error} onRetry={() => void refetch()} />
          ) : recent.length === 0 ? (
            <EmptyState
              icon={Gavel}
              title="Nothing on your Docket yet"
              description="Matters you create or are assigned will appear here."
              action={
                <Button size="sm" onClick={() => navigate(ROUTES.docket)}>
                  Go to Docket
                </Button>
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {recent.map((matter) => (
                <li key={matter.id}>
                  <button
                    type="button"
                    onClick={() => navigate(ROUTES.docketMatter(matter.id))}
                    className="flex w-full items-center justify-between gap-2 py-3 text-left hover:bg-muted/40"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">
                        {matter.matter_title}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {matter.case_number}
                      </p>
                    </div>
                    {matter.status && (
                      <Badge variant={STATUS_VARIANT[matter.status] ?? "outline"}>
                        {matter.status}
                      </Badge>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
