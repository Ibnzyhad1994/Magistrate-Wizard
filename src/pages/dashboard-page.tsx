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
import { APP_NAME } from "@/lib/constants";
import { ROUTES } from "@/routes/paths";
import { formatDate, formatTimeOnly, toTitleCase } from "@/lib/utils";

/**
 * Every card here reads from data the caller is already RLS-permitted to
 * see — the same underlying queries used by each workspace's own list
 * page, just capped and summarized. No global/administrative counts, and
 * nothing here leaks the existence of rows the caller can't otherwise see.
 */
export default function DashboardPage() {
  const { user } = useAuth();
  const {
    data: matters,
    isPending: mattersPending,
    isError: mattersError,
    error: mattersErr,
    refetch: refetchMatters,
  } = useDocketMatters("");
  const { data: courts, isPending: courtsPending } = useCurrentCourts();
  const { data: appearances, isPending: appearancesPending } = useUpcomingAppearances();
  const { data: retained, isPending: retainedPending } = useMyRetainedMatters();
  const { data: judgments, isPending: judgmentsPending } = useJudgments();
  const { data: quickCodes, isPending: quickCodesPending } = useQuickCodes();
  const { data: benchNotes, isPending: benchNotesPending } = useBenchNotes();

  const activeMatters = useMemo(
    () => (matters ?? []).filter((m) => m.status === "active"),
    [matters],
  );

  const { myDrafts, myFinal } = useMemo(() => {
    const all = judgments ?? [];
    return {
      myDrafts: all.filter((j) => j.owner_id === user?.id && j.status === "draft"),
      myFinal: all.filter((j) => j.owner_id === user?.id && j.status === "final"),
    };
  }, [judgments, user?.id]);

  const noCourts = !courtsPending && (courts?.length ?? 0) === 0;
  const firstAppearance = appearances?.[0];
  const appearanceMatter = rel(firstAppearance?.docket_matters);
  const firstMatter = matters?.[0];

  const billboard = firstAppearance
    ? {
        tone: "docket" as const,
        eyebrow: appearanceMatter?.case_number ?? "Upcoming appearance",
        title: appearanceMatter?.matter_title ?? "Upcoming appearance",
        description: [
          eventLabel(firstAppearance.event_type),
          formatDate(firstAppearance.scheduled_date),
          firstAppearance.scheduled_time
            ? formatTimeOnly(firstAppearance.scheduled_time)
            : null,
        ]
          .filter(Boolean)
          .join(" · "),
        badges: [toTitleCase(firstAppearance.event_status)],
        primaryAction: {
          label: "Open matter",
          href: ROUTES.docketMatter(firstAppearance.docket_matter_id),
        },
        secondaryAction: { label: "Docket", href: ROUTES.docket },
      }
    : firstMatter
      ? {
          tone: "docket" as const,
          eyebrow: firstMatter.case_number,
          title: firstMatter.matter_title,
          description: issueOf(firstMatter),
          badges: [toTitleCase(firstMatter.status)],
          primaryAction: {
            label: "Open matter",
            href: ROUTES.docketMatter(firstMatter.id),
          },
          secondaryAction: { label: "More info", href: ROUTES.docket },
        }
      : {
          tone: "docket" as const,
          eyebrow: APP_NAME,
          title: "Your bench, in session",
          description: noCourts
            ? "Your account is active, but you have not yet been assigned to a Court. Contact an administrator. Judgments, Case Law, Quick Codes, and Bench Notes remain available — Docket access requires a Court assignment."
            : "Your docket, judgments, and research — in one bench.",
          badges: noCourts ? ["No court assignment"] : undefined,
          primaryAction: { label: "Browse docket", href: ROUTES.docket },
          secondaryAction: { label: "Judgments", href: ROUTES.judgments },
        };

  return (
    <div>
      <Billboard {...billboard} />

      <div className="relative z-10 -mt-16 space-y-9 pb-20">
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

        {(mattersPending || activeMatters.length > 0) && (
          <ContentRow title="Continue Working" href={ROUTES.docket} isLoading={mattersPending}>
            {activeMatters.map((m) => (
              <TitleCard
                key={m.id}
                tone="docket"
                eyebrow={m.case_number}
                title={m.matter_title}
                subtitle={issueOf(m)}
                badge={toTitleCase(m.status)}
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
                  key={event.id}
                  tone="docket"
                  eyebrow={matter?.case_number}
                  title={matter?.matter_title ?? eventLabel(event.event_type)}
                  subtitle={[formatDate(event.scheduled_date), event.scheduled_time ? formatTimeOnly(event.scheduled_time) : null]
                    .filter(Boolean)
                    .join(" · ")}
                  badge={eventLabel(event.event_type)}
                  href={ROUTES.docketMatter(event.docket_matter_id)}
                />
              );
            })}
          </ContentRow>
        )}

        {(judgmentsPending || myDrafts.length > 0) && (
          <ContentRow title="Draft Judgments" href={ROUTES.judgments} isLoading={judgmentsPending}>
            {myDrafts.map((j) => (
              <TitleCard
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

        {(judgmentsPending || myFinal.length > 0) && (
          <ContentRow title="Final Judgments" href={ROUTES.judgments} isLoading={judgmentsPending}>
            {myFinal.map((j) => (
              <TitleCard
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

        {(retainedPending || (retained?.length ?? 0) > 0) && (
          <ContentRow title="Retained / Part-Heard" href={ROUTES.docket} isLoading={retainedPending}>
            {(retained ?? []).map((row) => {
              const matter = rel(row.docket_matters);
              return (
                <TitleCard
                  key={row.id}
                  tone="docket"
                  eyebrow={matter?.case_number}
                  title={matter?.matter_title ?? "Retained matter"}
                  badge="Retained"
                  href={ROUTES.docketMatter(row.docket_matter_id)}
                />
              );
            })}
          </ContentRow>
        )}

        {(benchNotesPending || (benchNotes?.length ?? 0) > 0) && (
          <ContentRow title="Bench Notes" href={ROUTES.benchNotes} isLoading={benchNotesPending}>
            {(benchNotes ?? []).map((note) => (
              <TitleCard
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

        {(quickCodesPending || (quickCodes?.length ?? 0) > 0) && (
          <ContentRow title="Quick Codes" href={ROUTES.quickCodes} isLoading={quickCodesPending}>
            {(quickCodes ?? []).map((code) => (
              <TitleCard
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

function issueOf(matter: { charge_or_issue?: string | null } | { headline?: string }) {
  return "charge_or_issue" in matter ? (matter.charge_or_issue ?? undefined) : undefined;
}
