import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Gavel, ArrowRight, Landmark, CalendarClock, UserCheck, Scale, Braces, StickyNote, ShieldAlert } from "lucide-react";
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
import { useCurrentCourts, useMyRetainedMatters, useUpcomingAppearances } from "@/hooks/use-dashboard";
import { useJudgments } from "@/hooks/judgments/use-judgments";
import { useQuickCodes } from "@/hooks/quick-codes/use-quick-codes";
import { useBenchNotes } from "@/hooks/bench-notes/use-bench-notes";
import { ROLE_LABELS, type UserRole } from "@/lib/constants";
import { ROUTES } from "@/routes/paths";
import { formatDate, formatTimeOnly, toTitleCase } from "@/lib/utils";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  active: "default",
  stayed: "secondary",
  completed: "outline",
  archived: "outline",
};

/**
 * Every card here reads from data the caller is already RLS-permitted to
 * see — the same underlying queries used by each workspace's own list
 * page, just capped and summarized. No global/administrative counts, and
 * nothing here leaks the existence of rows the caller can't otherwise see.
 */
export default function DashboardPage() {
  const { profile, user } = useAuth();
  const navigate = useNavigate();
  const displayName = profile?.full_name ?? user?.email ?? "there";
  const role = profile?.role as UserRole | undefined;

  const { data: matters, isPending: mattersPending, isError: mattersError, error: mattersErr, refetch: refetchMatters } = useDocketMatters("");
  const { data: courts, isPending: courtsPending } = useCurrentCourts();
  const { data: appearances, isPending: appearancesPending } = useUpcomingAppearances();
  const { data: retained, isPending: retainedPending } = useMyRetainedMatters();
  const { data: judgments, isPending: judgmentsPending } = useJudgments();
  const { data: quickCodes, isPending: quickCodesPending } = useQuickCodes();
  const { data: benchNotes, isPending: benchNotesPending } = useBenchNotes();

  const recentMatters = matters?.slice(0, 5) ?? [];
  const activeCount = matters?.filter((m) => m.status === "active").length ?? 0;

  const { myDrafts, myFinal } = useMemo(() => {
    const all = judgments ?? [];
    return {
      myDrafts: all.filter((j) => j.owner_id === user?.id && j.status === "draft"),
      myFinal: all.filter((j) => j.owner_id === user?.id && j.status === "final"),
    };
  }, [judgments, user?.id]);

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

      {!courtsPending && (courts?.length ?? 0) === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex items-start gap-3 p-4">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium text-foreground">
                No current Court assignment
              </p>
              <p className="text-sm text-muted-foreground">
                Your account is active, but you have not yet been assigned to a
                Court. Contact an administrator. You can still use Judgments,
                Case Law research, Quick Codes, Bench Notes, and Bookmarks in
                the meantime — Docket access requires a Court assignment.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          icon={Landmark}
          label="Current Courts"
          value={courtsPending ? undefined : courts?.length ?? 0}
        />
        <SummaryCard
          icon={Gavel}
          label="Active Docket Matters"
          value={mattersPending ? undefined : activeCount}
        />
        <SummaryCard
          icon={Scale}
          label="Draft Judgments"
          value={judgmentsPending ? undefined : myDrafts.length}
        />
        <SummaryCard
          icon={UserCheck}
          label="Retained Matters"
          value={retainedPending ? undefined : retained?.length ?? 0}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
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
            {mattersPending ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : mattersError ? (
              <InlineError error={mattersErr} onRetry={() => void refetchMatters()} />
            ) : recentMatters.length === 0 ? (
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
                {recentMatters.map((matter) => (
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
                        <p className="text-xs text-muted-foreground">{matter.case_number}</p>
                      </div>
                      {matter.status && (
                        <Badge variant={STATUS_VARIANT[matter.status] ?? "outline"}>
                          {toTitleCase(matter.status)}
                        </Badge>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4" />
                Upcoming Appearances
              </CardTitle>
              <CardDescription>Scheduled Docket Events across your matters.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            {appearancesPending ? (
              <Skeleton className="h-24 w-full" />
            ) : !appearances || appearances.length === 0 ? (
              <EmptyState
                icon={CalendarClock}
                title="Nothing scheduled"
                description="Upcoming scheduled Docket Events will appear here."
              />
            ) : (
              <ul className="divide-y divide-border">
                {appearances.map((event) => (
                  <li key={event.id}>
                    <button
                      type="button"
                      onClick={() => navigate(ROUTES.docketMatter(event.docket_matter_id))}
                      className="flex w-full items-center justify-between gap-2 py-3 text-left hover:bg-muted/40"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">
                          {event.docket_matters?.matter_title ?? "Unavailable"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {event.event_type ?? "Event"}
                          {event.docket_matters?.case_number
                            ? ` · ${event.docket_matters.case_number}`
                            : ""}
                        </p>
                      </div>
                      <Badge variant="outline">
                        {formatDate(event.scheduled_date)}
                        {event.scheduled_time ? ` ${formatTimeOnly(event.scheduled_time)}` : ""}
                      </Badge>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Braces className="h-4 w-4" />
              Recent Quick Codes
            </CardTitle>
          </CardHeader>
          <CardContent>
            {quickCodesPending ? (
              <Skeleton className="h-20 w-full" />
            ) : !quickCodes || quickCodes.length === 0 ? (
              <EmptyState
                icon={Braces}
                title="No Quick Codes yet"
                action={
                  <Button size="sm" onClick={() => navigate(ROUTES.quickCodes)}>
                    Go to Quick Codes
                  </Button>
                }
              />
            ) : (
              <ul className="space-y-2">
                {quickCodes.slice(0, 5).map((qc) => (
                  <li key={qc.id} className="flex items-center justify-between text-sm">
                    <span className="font-mono text-foreground">{qc.code_word}</span>
                    <span className="truncate text-muted-foreground">{qc.title}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <StickyNote className="h-4 w-4" />
              Recent Bench Notes
            </CardTitle>
          </CardHeader>
          <CardContent>
            {benchNotesPending ? (
              <Skeleton className="h-20 w-full" />
            ) : !benchNotes || benchNotes.length === 0 ? (
              <EmptyState
                icon={StickyNote}
                title="No Bench Notes yet"
                action={
                  <Button size="sm" onClick={() => navigate(ROUTES.benchNotes)}>
                    Go to Bench Notes
                  </Button>
                }
              />
            ) : (
              <ul className="divide-y divide-border">
                {benchNotes.slice(0, 5).map((note) => (
                  <li key={note.id}>
                    <button
                      type="button"
                      onClick={() => navigate(ROUTES.benchNoteDetail(note.id))}
                      className="flex w-full items-center justify-between py-2 text-left text-sm hover:bg-muted/40"
                    >
                      <span className="truncate text-foreground">{note.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatDate(note.updated_at)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Retained Matters</CardTitle>
            <CardDescription>Matters you're currently retaining as part-heard.</CardDescription>
          </CardHeader>
          <CardContent>
            {retainedPending ? (
              <Skeleton className="h-20 w-full" />
            ) : !retained || retained.length === 0 ? (
              <EmptyState icon={UserCheck} title="No retained matters" />
            ) : (
              <ul className="divide-y divide-border">
                {retained.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => navigate(ROUTES.docketMatter(r.docket_matter_id))}
                      className="flex w-full items-center justify-between py-2 text-left text-sm hover:bg-muted/40"
                    >
                      <span className="truncate text-foreground">
                        {r.docket_matters?.matter_title ?? "Unavailable"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {r.docket_matters?.case_number}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>My Judgments</CardTitle>
            <CardDescription>
              {judgmentsPending ? "Loading…" : `${myDrafts.length} draft, ${myFinal.length} final`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button size="sm" variant="outline" onClick={() => navigate(ROUTES.judgments)}>
              Go to Judgments
              <ArrowRight className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | undefined;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <p className="text-xl font-semibold text-foreground">
            {value === undefined ? <Skeleton className="h-6 w-8" /> : value}
          </p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}
