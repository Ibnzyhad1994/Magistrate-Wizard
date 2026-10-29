import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { useKeysetList } from "@/hooks/use-keyset-list";
import {
  applyKeyset,
  type KeysetCursor,
  type KeysetSpec,
  toKeysetPage,
} from "@/lib/keyset-pagination";
import type { Database } from "@/types/database.types";
import { getLocalDateOnly } from "@/lib/utils";

/**
 * Current Court assignments — deliberately reads `magistrate_courts`
 * (the real, start/end-dated assignment table backing `can_access_court()`
 * and every Docket authority check), NOT the legacy `profiles.court_id`
 * single-value field that `my_court_id()` reads. That field predates the
 * proper assignment model and is not authoritative for "what Courts do I
 * currently have access to" — see architecture notes on 0022+.
 */
export function useCurrentCourts() {
  return useQuery({
    queryKey: ["dashboard", "current-courts"],
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from("magistrate_courts")
        .select("id, court_id, assignment_type, started_at, courts(id, name, jurisdiction)")
        .eq("profile_id", user.id)
        .is("ended_at", null)
        .order("started_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

/**
 * Upcoming, still-scheduled Docket Events across every matter the caller
 * can currently view — RLS (`can_view_docket_matter`) filters this
 * transparently, no client-side matter-access filtering layered on top.
 */
export function useUpcomingAppearances() {
  return useQuery({
    queryKey: ["dashboard", "upcoming-appearances"],
    queryFn: async () => {
      // Local calendar date, not UTC — see getLocalDateOnly() for why.
      const today = getLocalDateOnly();
      const { data, error } = await supabase
        .from("docket_events")
        .select(
          "id, docket_matter_id, event_type, scheduled_date, scheduled_time, event_status, docket_matters(id, matter_title, case_number, charge_or_issue, status, cover_image_path, deleted_at)",
        )
        .gte("scheduled_date", today)
        .eq("event_status", "scheduled")
        .order("scheduled_date", { ascending: true })
        .limit(8);
      if (error) throw error;
      return (data ?? []).filter((row) => {
        const matter = Array.isArray(row.docket_matters)
          ? row.docket_matters[0]
          : row.docket_matters;
        return matter && !matter.deleted_at;
      });
    },
  });
}

/** The caller's own currently-active retained ("part-heard") assignments. */
export function useMyRetainedMatters() {
  return useQuery({
    queryKey: ["dashboard", "my-retained-matters"],
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return [];
      const { data: assignments, error } = await supabase
        .from("docket_matter_assignments")
        .select("id, docket_matter_id, started_at")
        .eq("profile_id", user.id)
        .eq("reason", "retained_part_heard")
        .is("ended_at", null)
        .order("started_at", { ascending: false })
        .limit(8);
      if (error) throw error;
      if (!assignments || assignments.length === 0) return [];

      const ids = assignments.map((row) => row.docket_matter_id);
      const { data: matters, error: mattersError } = await supabase
        .from("docket_matters")
        .select("id, matter_title, case_number, charge_or_issue, status, cover_image_path")
        .in("id", ids)
        .is("deleted_at", null);
      if (mattersError) throw mattersError;

      const byId = new Map((matters ?? []).map((matter) => [matter.id, matter]));
      return assignments
        .map((row) => ({
          ...row,
          docket_matters: byId.get(row.docket_matter_id) ?? null,
        }))
        .filter((row) => row.docket_matters);
    },
  });
}

export type DashboardEventPulseRow = {
  id: string;
  docket_matter_id: string;
  scheduled_date: string;
  scheduled_time: string | null;
  event_status: string;
  event_type: string | null;
  outcome_at_event: string | null;
  orders_made_at_event: string | null;
  case_number: string | null;
  matter_title: string | null;
};

/** Earliest first, untimed appearances first within a day, `id` breaking ties. */
export const DASHBOARD_EVENT_PULSE_PAGE: KeysetSpec = {
  columns: [
    { column: "scheduled_date", ascending: true },
    { column: "scheduled_time", ascending: true, nullsFirst: true },
    { column: "id", ascending: true },
  ],
  pageSize: 400,
};

/**
 * One page of `useDashboardEventPulse`; the total is counted on the first
 * page only. Appearances of deleted matters are left out in the database
 * (`!inner` plus the `deleted_at` filter), so the count and every page
 * hold only rows the dashboard shows. `spec` is overridable only so the
 * live test can force many page boundaries.
 */
export async function fetchDashboardEventPulsePage(
  client: SupabaseClient<Database>,
  from: string,
  to: string,
  cursor: KeysetCursor | null,
  spec: KeysetSpec = DASHBOARD_EVENT_PULSE_PAGE,
) {
  const { data, error, count } = await applyKeyset(
    client
      .from("docket_events")
      .select(
        "id, docket_matter_id, scheduled_date, scheduled_time, event_status, event_type, outcome_at_event, orders_made_at_event, docket_matters!inner(case_number, matter_title, deleted_at)",
        { count: cursor ? undefined : "exact" },
      )
      .gte("scheduled_date", from)
      .lte("scheduled_date", to)
      .is("docket_matters.deleted_at", null),
    spec,
    cursor,
  );
  if (error) throw error;
  const rows = (data ?? []).flatMap((row): DashboardEventPulseRow[] => {
    const matter = Array.isArray(row.docket_matters) ? row.docket_matters[0] : row.docket_matters;
    if (!matter) return [];
    return [
      {
        id: row.id,
        docket_matter_id: row.docket_matter_id,
        scheduled_date: row.scheduled_date,
        scheduled_time: row.scheduled_time,
        event_status: row.event_status,
        event_type: row.event_type,
        outcome_at_event: row.outcome_at_event,
        orders_made_at_event: row.orders_made_at_event,
        case_number: matter.case_number,
        matter_title: matter.matter_title,
      },
    ];
  });
  return toKeysetPage(rows, spec, count);
}

/**
 * Appearances in a date window, including outcome/orders so the briefing
 * can tell a logged sitting from one still marked scheduled. RLS
 * (`can_view_docket_matter`) is the only access filter.
 *
 * Keyset-paged (BE-15): `data` is every row loaded so far, starting with
 * the first page of 400; `fetchNextPage`/`hasNextPage` load the rest and
 * `totalCount` says how many appearances the window holds.
 */
export function useDashboardEventPulse(from: string, to: string, options?: { enabled?: boolean }) {
  return useKeysetList({
    queryKey: ["dashboard", "event-pulse", from, to],
    enabled: options?.enabled ?? true,
    fetchPage: (cursor) => fetchDashboardEventPulsePage(supabase, from, to, cursor),
  });
}

/** Distinct matter ids that already have at least one party row. */
export function useDashboardPartyPresence(matterIds: string[], options?: { enabled?: boolean }) {
  const ids = [...new Set(matterIds)].sort();
  return useQuery({
    queryKey: ["dashboard", "party-presence", ids],
    enabled: (options?.enabled ?? true) && ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("docket_matter_parties")
        .select("docket_matter_id")
        .in("docket_matter_id", ids)
        .neq("party_status", "entered_in_error");
      if (error) throw error;
      return new Set((data ?? []).map((row) => row.docket_matter_id));
    },
  });
}

/** All currently-active retained matter ids (no carousel cap). */
export function useMyRetainedMatterIds(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["dashboard", "my-retained-matter-ids"],
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return [] as string[];
      const { data, error } = await supabase
        .from("docket_matter_assignments")
        .select("docket_matter_id")
        .eq("profile_id", user.id)
        .eq("reason", "retained_part_heard")
        .is("ended_at", null);
      if (error) throw error;
      return (data ?? []).map((row) => row.docket_matter_id);
    },
  });
}

/** Jacket fields for retained ids that missed the 100-row board cap. */
export function useMatterSummaries(ids: string[], options?: { enabled?: boolean }) {
  const sorted = [...ids].sort();
  return useQuery({
    queryKey: ["dashboard", "matter-summaries", sorted],
    enabled: (options?.enabled ?? true) && sorted.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("docket_matters")
        .select("id, case_number, matter_title, status")
        .in("id", sorted)
        .is("deleted_at", null);
      if (error) throw error;
      return data ?? [];
    },
  });
}
