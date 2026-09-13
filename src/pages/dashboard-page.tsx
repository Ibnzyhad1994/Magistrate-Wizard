import { useMemo } from "react";
import { Billboard, ContentRow, TitleCard } from "@/components/browse";
import { InlineError } from "@/components/common/inline-error";
import { useAuth } from "@/hooks/use-auth";
import { useDocketMatters } from "@/hooks/docket/use-docket-matters";
import {
  useMyRetainedMatters,
  useUpcomingAppearances,
} from "@/hooks/use-dashboard";
import { useJudgments } from "@/hooks/judgments/use-judgments";
import { useQuickCodes } from "@/hooks/quick-codes/use-quick-codes";
import { useBenchNotes } from "@/hooks/bench-notes/use-bench-notes";
import { useSignedUrls } from "@/hooks/use-signed-urls";
import { useMyClerkAccessRequests } from "@/hooks/clerk/use-clerk-access";
import { useMyCurrentCourts } from "@/hooks/docket/use-lookups";
import { clerkHomeState, clerkPendingDescription } from "@/lib/clerk-home";
import { APP_NAME } from "@/lib/constants";
import { ROUTES } from "@/routes/paths";
import { formatDate, formatTimeOnly, toTitleCase } from "@/lib/utils";

/**
 * Every card here reads from data the caller is already RLS-permitted to
 * see — the same underlying queries used by each workspace's own list
 * page, just capped and summarized. No global/administrative counts, and
 * nothing here leaks the existence of rows the caller can't otherwise see.
 *
 * Role-branched: a clerk (pending or approved) never sees the
 * magistrate's Judgments/Bench Notes/Quick Codes/Retained rows or the
 * Judgments shortcut — those queries aren't even fetched for a clerk, not
 * merely hidden once empty. A pending clerk (zero currently-active
 * clerk_courts rows) sees the pending-approval welcome instead of any
 * operational content at all. Access requests never grant the Docket.
 */
export default function DashboardPage() {
  const { user, profile } = useAuth();
  const rolePending = !profile;
  const isClerk = profile?.role === "clerk";
  const {
    data: matters,
    isPending: mattersPending,
    isError: mattersError,
    error: mattersErr,
    refetch: refetchMatters,
  } = useDocketMatters("");
  const { data: myCourts, isPending: courtsPending } = useMyCurrentCourts();
  const { data: appearances, isPending: appearancesPending } = useUpcomingAppearances();
  const { data: retained } = useMyRetainedMatters();
  const { data: judgments, isPending: judgmentsPending } = useJudgments({ enabled: Boolean(profile) && !isClerk });
  const { data: quickCodes, isPending: quickCodesPending } = useQuickCodes({ enabled: Boolean(profile) && !isClerk });
  const { data: benchNotes, isPending: benchNotesPending } = useBenchNotes({ enabled: Boolean(profile) && !isClerk });
  const { data: clerkRequests } = useMyClerkAccessRequests();

  const activeMatters = useMemo(
    () => (matters ?? []).filter((m) => m.status === "active"),
    [matters],
  );

  const retainedIds = useMemo(
    () => new Set((retained ?? []).map((row) => row.docket_matter_id)),
    [retained],
  );

  const continueWorking = useMemo(
    () => activeMatters.filter((m) => !retainedIds.has(m.id)),
    [activeMatters, retainedIds],
  );

  const { myDrafts, myFinal } = useMemo(() => {
    const all = judgments ?? [];
    return {
      myDrafts: all.filter((j) => j.owner_id === user?.id && j.status === "draft"),
      myFinal: all.filter((j) => j.owner_id === user?.id && j.status === "final"),
    };
  }, [judgments, user?.id]);

  const coverPaths = useMemo(() => {
    const paths: (string | null | undefined)[] = [];
    for (const m of matters ?? []) {
      if ("cover_image_path" in m) paths.push(m.cover_image_path);
    }
    for (const event of appearances ?? []) {
      paths.push(rel(event.docket_matters)?.cover_image_path);
    }
    for (const row of retained ?? []) {
      paths.push(rel(row.docket_matters)?.cover_image_path);
    }
    return paths;
  }, [matters, appearances, retained]);
  const { data: coverUrls } = useSignedUrls(coverPaths);

  function coverUrl(path: string | null | undefined) {
    return path ? coverUrls?.[path] : undefined;
  }

  // Personalized welcome hero, not a specific case/matter — the home
  // screen is the entry point into the app, not a particular docket item.
  // Real matter/appearance data still populates the rows below unchanged.
  const name = profile?.full_name?.trim() || null;

  const pendingClerkRequests = (clerkRequests ?? []).filter((r) => r.status === "pending");
  const clerkState = rolePending
    ? "loading"
    : isClerk
      ? clerkHomeState({
          courtsPending,
          courtCount: myCourts?.length ?? 0,
        })
      : "ready";
  const isPendingClerk = clerkState === "pending";
  const sittingNames = (myCourts ?? []).map((c) => c.court_name).filter(Boolean);
  const sittingPending = courtsPending;

  // A magistrate can no longer reach this page at all without an
  // approved court (requireApprovedMagistrateCourt, router.tsx — they're
  // redirected to /court-assignments before DashboardPage ever mounts),
  // so there is no remaining "no court" case to special-case for the
  // magistrate persona this billboard is written for. An admin with no
  // personal magistrate_courts row is unaffected by that gate and can
  // still land here — the "Sitting at ..." line below already handles
  // that plainly (it just doesn't render), so no separate banner is
  // needed for them either.
  const billboard = rolePending
    ? {
        tone: "judgment" as const,
        eyebrow: APP_NAME,
        title: "Welcome",
        description: "Loading your workspace.",
      }
    : !isClerk
    ? {
        tone: "judgment" as const,
        eyebrow: APP_NAME,
        title: name ? `Welcome, Magistrate ${name}` : "Welcome, Magistrate",
        description: `Your ${APP_NAME} workspace is ready. Access your docket, legal resources, case law, and judicial tools from one place.`,
        primaryAction: { label: "New matter", href: `${ROUTES.docket}?new=1` },
        secondaryAction: { label: "Browse docket", href: ROUTES.docket },
        tertiaryAction: { label: "Judgments", href: ROUTES.judgments },
      }
    : clerkState === "loading"
      ? {
          tone: "judgment" as const,
          eyebrow: APP_NAME,
          title: name ? `Welcome, Clerk ${name}` : "Welcome, Clerk",
          description: "Loading your court assignment.",
        }
      : isPendingClerk
      ? {
          tone: "judgment" as const,
          eyebrow: APP_NAME,
          title: name ? `Welcome, ${name}` : "Welcome",
          description: clerkPendingDescription({
            pendingRequestCount: pendingClerkRequests.length,
            pendingCourtName: pendingClerkRequests[0]?.courts?.name,
          }),
          primaryAction: { label: "View my requests", href: ROUTES.clerkAccess },
        }
      : {
          tone: "judgment" as const,
          eyebrow: APP_NAME,
          title: name ? `Welcome, Clerk ${name}` : "Welcome, Clerk",
          description: `Your ${APP_NAME} docket is ready. Manage matters and hearings for your approved court${(myCourts?.length ?? 0) > 1 ? "s" : ""}.`,
          primaryAction: { label: "Open docket", href: ROUTES.docket },
        };

  return (
    <div>
      <Billboard
        {...billboard}
        caption={
          !sittingPending && sittingNames.length > 0
            ? `Sitting at ${sittingNames.join(" · ")}`
            : undefined
        }
      />

      <div className="relative z-10 -mt-8 space-y-9 pb-20 dark:-mt-16">
        {isPendingClerk || clerkState === "loading" ? null : (
          <>
        {mattersError && (
          <div className="browse-gutter">
            <InlineError error={mattersErr} onRetry={() => void refetchMatters()} />
          </div>
        )}

        {(mattersPending || continueWorking.length > 0) && (
          <ContentRow title="Continue Working" href={ROUTES.docket} isLoading={mattersPending}>
            {continueWorking.map((m) => (
              <TitleCard
                layout="tiles"
                key={m.id}
                tone="docket"
                eyebrow={m.case_number}
                title={m.matter_title}
                subtitle={issueOf(m)}
                badge={toTitleCase(m.status)}
                meta={"courts" in m ? [rel(m.courts)?.name].filter((v): v is string => Boolean(v)) : undefined}
                imageUrl={coverUrl("cover_image_path" in m ? m.cover_image_path : null)}
                href={ROUTES.docketMatter(m.id)}
              />
            ))}
          </ContentRow>
        )}

        {(appearancesPending || (appearances?.length ?? 0) > 0) && (
          <ContentRow title="Upcoming Appearances" href={ROUTES.docket} isLoading={appearancesPending}>
            {(appearances ?? []).map((event) => {
              const matter = rel(event.docket_matters);
              return (
                <TitleCard
                  layout="tiles"
                  key={event.id}
                  tone="docket"
                  eyebrow={matter?.case_number}
                  title={matter?.matter_title ?? eventLabel(event.event_type)}
                  subtitle={matter?.charge_or_issue ?? undefined}
                  badge={eventLabel(event.event_type)}
                  meta={[
                    formatDate(event.scheduled_date),
                    event.scheduled_time ? formatTimeOnly(event.scheduled_time) : null,
                  ].filter((v): v is string => Boolean(v))}
                  imageUrl={coverUrl(matter?.cover_image_path)}
                  href={ROUTES.docketMatter(event.docket_matter_id)}
                />
              );
            })}
          </ContentRow>
        )}

        {!isClerk && (judgmentsPending || myDrafts.length > 0) && (
          <ContentRow title="Draft Judgments" href={ROUTES.judgments} isLoading={judgmentsPending}>
            {myDrafts.map((j) => (
              <TitleCard
                layout="tiles"
                key={j.id}
                tone="judgment"
                eyebrow={j.case_number ?? undefined}
                title={j.title}
                subtitle={j.court_name ?? j.citation ?? undefined}
                badge="Draft"
                href={ROUTES.judgmentDetail(j.id)}
              />
            ))}
          </ContentRow>
        )}

        {!isClerk && (judgmentsPending || myFinal.length > 0) && (
          <ContentRow title="Final Judgments" href={ROUTES.judgments} isLoading={judgmentsPending}>
            {myFinal.map((j) => (
              <TitleCard
                layout="tiles"
                key={j.id}
                tone="judgment"
                eyebrow={j.case_number ?? undefined}
                title={j.title}
                subtitle={j.court_name ?? j.citation ?? undefined}
                badge="Final"
                href={ROUTES.judgmentDetail(j.id)}
              />
            ))}
          </ContentRow>
        )}

        {!isClerk && (retained?.length ?? 0) > 0 && (
          <ContentRow title="Retained / Part-Heard" href={ROUTES.docket}>
            {(retained ?? []).map((row) => {
              const matter = rel(row.docket_matters);
              return (
                <TitleCard
                  layout="tiles"
                  key={row.id}
                  tone="docket"
                  eyebrow={matter?.case_number}
                  title={matter?.matter_title ?? "Retained matter"}
                  subtitle={matter?.charge_or_issue ?? undefined}
                  badge={matter?.status ? toTitleCase(matter.status) : "Retained"}
                  imageUrl={coverUrl(matter?.cover_image_path)}
                  href={ROUTES.docketMatter(row.docket_matter_id)}
                />
              );
            })}
          </ContentRow>
        )}

        {!isClerk && (benchNotesPending || (benchNotes?.length ?? 0) > 0) && (
          <ContentRow title="Bench Notes" href={ROUTES.benchNotes} isLoading={benchNotesPending}>
            {(benchNotes ?? []).map((note) => (
              <TitleCard
                layout="tiles"
                key={note.id}
                tone="note"
                eyebrow={entityLabel(note.entity_type)}
                title={note.title}
                badge={toTitleCase(note.status)}
                href={ROUTES.benchNoteDetail(note.id)}
              />
            ))}
          </ContentRow>
        )}

        {!isClerk && (quickCodesPending || (quickCodes?.length ?? 0) > 0) && (
          <ContentRow title="Quick Codes" href={ROUTES.quickCodes} isLoading={quickCodesPending}>
            {(quickCodes ?? []).map((code) => (
              <TitleCard
                layout="tiles"
                key={code.id}
                tone="code"
                eyebrow={code.code_word}
                title={code.title ?? code.code_word}
                subtitle={code.category ?? undefined}
                href={`${ROUTES.quickCodes}?qc=${code.id}`}
              />
            ))}
          </ContentRow>
        )}
          </>
        )}
      </div>
    </div>
  );
}

function rel<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function eventLabel(type: string | null | undefined) {
  return toTitleCase((type ?? "appearance").replace(/_/g, " "));
}

function entityLabel(type: string) {
  return toTitleCase(type.replace(/_/g, " "));
}

function issueOf(matter: { charge_or_issue?: string | null; headline?: string | null }) {
  if (matter.charge_or_issue) return matter.charge_or_issue;
  if (matter.headline) return matter.headline.replace(/<\/?b>/gi, "");
  return undefined;
}
