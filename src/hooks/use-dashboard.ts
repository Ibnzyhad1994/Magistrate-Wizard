import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
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
          "id, docket_matter_id, event_type, scheduled_date, scheduled_time, event_status, docket_matters(id, matter_title, case_number, charge_or_issue, status, cover_image_path)",
        )
        .gte("scheduled_date", today)
        .eq("event_status", "scheduled")
        .order("scheduled_date", { ascending: true })
        .limit(8);
      if (error) throw error;
      return data;
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
      const { data, error } = await supabase
        .from("docket_matter_assignments")
        .select("id, docket_matter_id, started_at, docket_matters(id, matter_title, case_number, charge_or_issue, status, cover_image_path)")
        .eq("profile_id", user.id)
        .eq("reason", "retained_part_heard")
        .is("ended_at", null)
        .order("started_at", { ascending: false })
        .limit(8);
      if (error) throw error;
      return data;
    },
  });
}
