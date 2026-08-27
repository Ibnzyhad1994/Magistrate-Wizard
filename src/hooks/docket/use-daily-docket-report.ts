import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/database.types";

export type DailyDocketReportRow =
  Database["public"]["Functions"]["get_daily_docket_report_data"]["Returns"][number];

/**
 * Fetches the exact same date-specific appearance data the report is
 * built from — get_daily_docket_report_data (0080/0081), SECURITY
 * INVOKER, so RLS restricts results to matters the caller is already
 * authorised to see, same as every other Docket view. A mutation rather
 * than a query: this is triggered on demand by "Generate Daily Progress
 * Report", not rendered continuously.
 */
export function useDailyDocketReportData() {
  return useMutation({
    mutationFn: async ({
      date,
      courtId,
    }: {
      date: string;
      /** Two-level Docket scope (0097): null = All My Courts (every authorized court), a specific id restricts the export to that exact court. */
      courtId: string | null;
    }): Promise<DailyDocketReportRow[]> => {
      const { data, error } = await supabase.rpc("get_daily_docket_report_data", {
        p_date: date,
        p_court_id: courtId ?? undefined,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}
