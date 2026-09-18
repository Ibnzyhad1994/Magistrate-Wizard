import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { NonSittingDay } from "@/lib/court-calendar";

export const courtCalendarKeys = {
  all: ["court-non-sitting-days"] as const,
};

/**
 * Every recorded non-sitting day in a window around today. Reference
 * data: small, changes a few times a year, and read by several surfaces,
 * so it is fetched once and kept for the session rather than per dialog.
 */
export function useNonSittingDays() {
  return useQuery({
    queryKey: courtCalendarKeys.all,
    // Reference data, not case data: a stale-by-an-hour court calendar is
    // not a correctness problem, and re-fetching it per dialog would be.
    staleTime: 60 * 60 * 1000,
    queryFn: async (): Promise<NonSittingDay[]> => {
      const { data, error } = await supabase
        .from("court_non_sitting_days")
        .select("holiday_date, name, kind, court_id, district_id")
        .order("holiday_date");
      if (error) throw error;
      return (data ?? []) as NonSittingDay[];
    },
  });
}
