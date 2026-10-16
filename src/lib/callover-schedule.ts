/**
 * Putting callover matters on the day's schedule.
 *
 * The Calendar and the Docket day list are built only from docket_events,
 * while a callover is a record of the sitting (0129) that never schedules
 * anything by itself. A matter typed in at a callover therefore needs its
 * own appearance on the callover date, or it is missing from that day.
 * The appearance is written through schedule_docket_event_with_capacity(),
 * the same capacity-checked path as every other "add a hearing" surface,
 * so a callover matter counts toward capacity and can be overridden the
 * same way. It does not use set_docket_matter_next_date(): that supersedes
 * the matter's next scheduled appearance, which would turn a callover-day
 * entry into an adjournment of a later hearing.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

type Client = SupabaseClient<Database>;

/** event_type of an appearance created for a callover; the agenda shows it as the hearing type. */
export const CALLOVER_EVENT_TYPE = "Callover";

export const calloverMatterKey = (date: string, matterId: string) => `${date}|${matterId}`;

type CalloverWithItems = {
  callover_date: string;
  docket_callover_items: readonly { docket_matter_id: string }[] | null;
};

/** Every (date, matter) pair that sits on a callover, for marking the schedule. */
export function calloverMatterKeys(callovers: readonly CalloverWithItems[]): Set<string> {
  const keys = new Set<string>();
  for (const callover of callovers) {
    for (const item of callover.docket_callover_items ?? []) {
      keys.add(calloverMatterKey(callover.callover_date, item.docket_matter_id));
    }
  }
  return keys;
}

/**
 * The appearance a callover row stands for on the sitting day. A row
 * already called is a record of what happened there, so it is filed as a
 * completed appearance carrying the row's outcome; one not yet called is
 * listed for the day like any other hearing.
 */
export function calloverAppearance(item: { called_at: string | null; outcome: string | null }): {
  eventStatus: "scheduled" | "completed";
  outcome: string | null;
} {
  if (item.called_at === null) return { eventStatus: "scheduled", outcome: null };
  return { eventStatus: "completed", outcome: item.outcome?.trim() || null };
}

/** Rows whose matter has no appearance on the callover date, so the day's schedule would miss them. */
export function itemsMissingFromSchedule<T extends { docket_matter_id: string }>(
  items: readonly T[],
  listedMatterIds: ReadonlySet<string>,
): T[] {
  return items.filter((item) => !listedMatterIds.has(item.docket_matter_id));
}

export type CapacityReached = {
  status: "capacity_reached";
  category_id: string | null;
  category_name: string | null;
  configured_capacity: number | null;
  scheduled_count: number | null;
};

export type ScheduleCalloverAppearanceInput = {
  matterId: string;
  date: string;
  categoryId: string | null;
  stageAtEvent?: string | null;
  eventStatus?: "scheduled" | "completed";
  outcome?: string | null;
  acknowledgeOverride?: boolean;
  overrideReason?: string | null;
};

export async function scheduleCalloverAppearance(
  client: Client,
  input: ScheduleCalloverAppearanceInput,
): Promise<{ status: "created"; eventId: string } | CapacityReached> {
  const { data, error } = await client.rpc("schedule_docket_event_with_capacity", {
    p_docket_matter_id: input.matterId,
    p_scheduled_date: input.date,
    p_event_type: CALLOVER_EVENT_TYPE,
    p_event_status: input.eventStatus ?? "scheduled",
    p_outcome_at_event: input.outcome ?? undefined,
    p_stage_at_event: input.stageAtEvent ?? undefined,
    p_category_id: input.categoryId ?? undefined,
    p_acknowledge_override: input.acknowledgeOverride ?? false,
    p_override_reason: input.overrideReason ?? undefined,
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new Error("No response from the scheduling function.");
  if (row.status === "capacity_reached") return { ...row, status: "capacity_reached" };
  return { status: "created", eventId: row.event_id };
}

const UNIQUE_VIOLATION = "23505";

/**
 * The open sitting for this court and day, started as a draft when there
 * is none. One open callover per court per day is a database rule
 * (docket_callovers_open_per_court_date_idx), so a concurrent start that
 * loses the race reads back the winner instead of failing.
 */
export async function findOrStartCallover(
  client: Client,
  courtId: string,
  date: string,
): Promise<string> {
  const findOpen = async () => {
    const { data, error } = await client
      .from("docket_callovers")
      .select("id")
      .eq("court_id", courtId)
      .eq("callover_date", date)
      .neq("status", "completed")
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data?.id ?? null;
  };
  const existing = await findOpen();
  if (existing) return existing;
  const { data, error } = await client
    .from("docket_callovers")
    .insert({ court_id: courtId, callover_date: date })
    .select("id")
    .single();
  if (!error) return data.id;
  if (error.code !== UNIQUE_VIOLATION) throw error;
  const winner = await findOpen();
  if (!winner) throw error;
  return winner;
}

/** Adds the matter to the end of the sheet; a matter already on it stays where it is. */
export async function addToCallover(client: Client, calloverId: string, matterId: string) {
  const { count, error: countError } = await client
    .from("docket_callover_items")
    .select("id", { count: "exact", head: true })
    .eq("callover_id", calloverId);
  if (countError) throw countError;
  const { error } = await client.from("docket_callover_items").insert({
    callover_id: calloverId,
    docket_matter_id: matterId,
    sort_order: (count ?? 0) + 1,
  });
  if (error && error.code !== UNIQUE_VIOLATION) throw error;
}

export type ListCalloverMatterInput = ScheduleCalloverAppearanceInput & {
  courtId: string;
  /** The sheet the matter was entered on; when absent, the court's open sitting that day. */
  calloverId?: string | null;
};

/**
 * A matter entered as a callover matter: listed on the day first, then
 * recorded on that day's callover sheet. Listing first means a refused
 * capacity check leaves nothing half-written for the override to undo.
 */
export async function listCalloverMatter(
  client: Client,
  input: ListCalloverMatterInput,
): Promise<{ status: "created"; eventId: string; calloverId: string } | CapacityReached> {
  const scheduled = await scheduleCalloverAppearance(client, input);
  if (scheduled.status === "capacity_reached") return scheduled;
  const calloverId =
    input.calloverId ?? (await findOrStartCallover(client, input.courtId, input.date));
  await addToCallover(client, calloverId, input.matterId);
  return { ...scheduled, calloverId };
}
