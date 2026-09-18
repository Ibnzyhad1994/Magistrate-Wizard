import { parseDateOnly } from "@/lib/utils";

/**
 * How long a file has been running, and how many times it has been
 * listed at the stage it is still at.
 *
 * Every figure here is arithmetic over appearances the caller can already
 * see -- `docket_events` has carried `stage_at_event` since 0024 and
 * nothing has ever read it back across dates. Nothing is predicted or
 * inferred; a file with no recorded appearances reports nothing rather
 * than guessing.
 *
 * Deliberately built from `docket_events` and NOT from `audit_log`: the
 * audit trail is compliance-scoped and ADR 0007 forbids building
 * judicial-content features on an admin path.
 */

export type AgeingEvent = {
  scheduled_date: string;
  stage_at_event: string | null;
  event_status: string | null;
};

export type MatterAgeing = {
  /** Appearances that actually happened, excluding cancelled ones. */
  listedCount: number;
  firstListed: string | null;
  lastListed: string | null;
  /** Whole days between the first appearance and today. */
  daysSinceFirstListed: number | null;
  /**
   * Consecutive most-recent appearances recorded at the same stage. Two
   * or more means the file was listed and came back no further on.
   */
  sittingsAtCurrentStage: number;
  currentStage: string | null;
};

/** Appearances that never happened tell you nothing about a file's age. */
const COUNTS_AS_LISTED = (event: AgeingEvent) =>
  event.event_status !== "cancelled" && event.event_status !== "entered_in_error";

export function matterAgeing(events: AgeingEvent[], today: string): MatterAgeing {
  const listed = events
    .filter(COUNTS_AS_LISTED)
    .filter((event) => event.scheduled_date <= today)
    .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date));

  if (listed.length === 0) {
    return {
      listedCount: 0,
      firstListed: null,
      lastListed: null,
      daysSinceFirstListed: null,
      sittingsAtCurrentStage: 0,
      currentStage: null,
    };
  }

  const first = listed[0].scheduled_date;
  const last = listed[listed.length - 1].scheduled_date;

  // Count back from the most recent appearance while the stage is
  // unchanged. A run of one is just "the last sitting", not drift.
  const currentStage = listed[listed.length - 1].stage_at_event ?? null;
  let run = 0;
  if (currentStage) {
    for (let i = listed.length - 1; i >= 0; i -= 1) {
      if (listed[i].stage_at_event !== currentStage) break;
      run += 1;
    }
  }

  const msPerDay = 24 * 60 * 60 * 1000;
  const days = Math.round(
    (parseDateOnly(today).getTime() - parseDateOnly(first).getTime()) / msPerDay,
  );

  return {
    listedCount: listed.length,
    firstListed: first,
    lastListed: last,
    daysSinceFirstListed: days,
    sittingsAtCurrentStage: run,
    currentStage,
  };
}

/**
 * One plain sentence, or null when there is nothing worth saying. Written
 * as a statement of record, never as advice: the product reports what the
 * file shows and leaves the judgement to the magistrate.
 */
export function ageingSummary(
  ageing: MatterAgeing,
  stageLabel: (stage: string) => string,
): string | null {
  if (ageing.listedCount === 0) return null;
  const times = ageing.listedCount === 1 ? "Listed once" : `Listed ${ageing.listedCount} times`;
  const since = ageing.daysSinceFirstListed;
  const months = since == null ? 0 : Math.floor(since / 30);
  const age =
    since == null || since < 1
      ? ""
      : since < 60
        ? ` over ${since} ${since === 1 ? "day" : "days"}`
        : ` over ${months} ${months === 1 ? "month" : "months"}`;
  const stalled =
    ageing.sittingsAtCurrentStage >= 2 && ageing.currentStage
      ? `, and still at ${stageLabel(ageing.currentStage)} after ${ageing.sittingsAtCurrentStage} of them`
      : "";
  return `${times}${age}${stalled}.`;
}
