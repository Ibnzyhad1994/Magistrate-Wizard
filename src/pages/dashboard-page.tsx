import { useMemo } from "react";
import { Billboard, ContentRow, TitleCard } from "@/components/browse";
import { InlineError } from "@/components/common/inline-error";
import { useAuth } from "@/hooks/use-auth";
import { useDocketMatters } from "@/hooks/docket/use-docket-matters";
import {
  useCurrentCourts,
  useMyRetainedMatters,
  useUpcomingAppearances,
} from "@/hooks/use-dashboard";
import { useJudgments } from "@/hooks/judgments/use-judgments";
import { useQuickCodes } from "@/hooks/quick-codes/use-quick-codes";
import { useBenchNotes } from "@/hooks/bench-notes/use-bench-notes";
import { useSignedUrls } from "@/hooks/use-signed-urls";
import { useMyClerkAccessRequests } from "@/hooks/clerk/use-clerk-access";
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
 * merely hidden once empty. A pending clerk (zero currently-active court
 * assignments) sees the pending-approval welcome instead of any
 * operational content at all.
 */
export default function DashboardPage() {
  const { user, profile } = useAuth();
  const isClerk = profile?.role === "clerk";
  const {
    data: matters,
    isPending: mattersPending,
    isError: mattersError,
    error: mattersErr,
    refetch: refetchMatters,
  } = useDocketMatters("");
  const { data: courts, isPending: courtsPending } = useCurrentCourts();
  const { data: appearances, isPending: appearancesPending } = useUpcomingAppearances();
  const { data: retained } = useMyRetainedMatters();
  const { data: judgments, isPending: judgmentsPending } = useJudgments({ enabled: !isClerk });
  const { data: quickCodes, isPending: quickCodesPending } = useQuickCodes({ enabled: !isClerk });
  const { data: benchNotes, isPending: benchNotesPending } = useBenchNotes({ enabled: !isClerk });
  const { data: clerkRequests, isPending: clerkRequestsPending } = useMyClerkAccessRequests();

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

  const approvedClerkRequests = (clerkRequests ?? []).filter((r) => r.status === "approved");
  const pendingClerkRequests = (clerkRequests ?? []).filter((r) => r.status === "pending");
  // A clerk with at least one approved court gets the ordinary clerk
  // welcome + Docket rows below, even while other requests remain
  // pending elsewhere — only a clerk with ZERO approved courts sees the
  // pending-approval experience in place of any operational content.
  const isPendingClerk = isClerk && !clerkRequestsPending && approvedClerkRequests.length === 0;

  // A magistrate can no longer reach this page at all without an
  // approved court (requireApprovedMagistrateCourt, router.tsx — they're
  // redirected to /court-assignments before DashboardPage ever mounts),
  // so there is no remaining "no court" case to special-case for the
  // magistrate persona this billboard is written for. An admin with no
  // personal magistrate_courts row is unaffected by that gate and can
  // still land here — the "Sitting at ..." line below already handles
  // that plainly (it just doesn't render), so no separate banner is
  // needed for them either.
  const billboard = !isClerk
    ? {
        tone: "judgment" as const,
        eyebrow: APP_NAME,
        title: name ? `Welcome, Magistrate ${name}` : "Welcome, Magistrate",
        description: `Your ${APP_NAME} workspace is ready. Access your docket, legal resources, case law, and judicial tools from one place.`,
        primaryAction: { label: "Browse docket", href: ROUTES.docket },
        secondaryAction: { label: "Judgments", href: ROUTES.judgments },
      }
    : isPendingClerk
      ? {
          tone: "judgment" as const,
          eyebrow: APP_NAME,
          title: name ? `Welcome, ${name}` : "Welcome",
          description:
            pendingClerkRequests.length === 1
              ? `Your request to access the docket for ${pendingClerkRequests[0].courts?.name ?? "your requested court"} is awaiting approval from the assigned magistrate.`
              : pendingClerkRequests.length > 1
                ? "Your court access requests are awaiting approval from each court's assigned magistrate."
                : "Request access to a court to get started. The court's assigned magistrate will review your request.",
          primaryAction: { label: "View my requests", href: ROUTES.clerkAccess },
        }
      : {
          tone: "judgment" as const,
          eyebrow: APP_NAME,
          title: name ? `Welcome, Clerk ${name}` : "Welcome, Clerk",
          description: `Your ${APP_NAME} docket is ready. Manage matters and hearings for your approved court${approvedClerkRequests.length > 1 ? "s" : ""}.`,
          primaryAction: { label: "Open docket", href: ROUTES.docket },
        };

  return (
    <div>
      <Billboard {...billboard} />

      <div className="relative z-10 -mt-16 space-y-9 pb-20">
        {isPendingClerk ? null : (
          <>
        {mattersError && (
          <div className="browse-gutter">
            <InlineError error={mattersErr} onRetry={() => void refetchMatters()} />
          </div>
        )}

        {!courtsPending && courts && courts.length > 0 && (
          <p className="browse-gutter text-sm text-white/55">
            Sitting at {courts.map((c) => rel(c.courts)?.name).filter(Boolean).join(" · ")}
          </p>
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
