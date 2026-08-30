import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import type { Database } from "@/types/database.types";

export type IssueReportStatus = Database["public"]["Tables"]["issue_reports"]["Row"]["status"];

export interface IssueReportRow {
  id: string;
  reporter_id: string;
  type: string;
  title: string;
  description: string;
  page_path: string | null;
  app_version: string | null;
  reporter_role: string | null;
  status: IssueReportStatus;
  admin_notes: string | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  profiles: { full_name: string | null; email: string } | null;
}

export const issueReportKeys = {
  all: ["admin", "issue-reports"] as const,
};

/**
 * Every issue report, newest first. Relies entirely on the existing
 * `issue_reports` SELECT RLS policy ("Admins can view all issue
 * reports") — this screen is only ever rendered for an admin (route is
 * gated by `ProtectedRoute allowedRoles={["admin"]}`), so this adds no
 * visibility beyond what an admin caller already lawfully has.
 */
export function useIssueReports() {
  return useQuery({
    queryKey: issueReportKeys.all,
    queryFn: async (): Promise<IssueReportRow[]> => {
      const { data, error } = await supabase
        .from("issue_reports")
        .select(
          "id, reporter_id, type, title, description, page_path, app_version, reporter_role, status, admin_notes, created_at, resolved_at, resolved_by, profiles!issue_reports_reporter_id_fkey(full_name, email)",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as IssueReportRow[];
    },
  });
}

export interface UpdateIssueReportParams {
  id: string;
  status: IssueReportStatus;
  adminNotes?: string | null;
}

export function useUpdateIssueReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status, adminNotes }: UpdateIssueReportParams) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const isResolved = status === "resolved" || status === "wont_fix";
      const { error } = await supabase
        .from("issue_reports")
        .update({
          status,
          ...(adminNotes !== undefined ? { admin_notes: adminNotes } : {}),
          resolved_at: isResolved ? new Date().toISOString() : null,
          resolved_by: isResolved ? (user?.id ?? null) : null,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Issue report updated.");
      void queryClient.invalidateQueries({ queryKey: issueReportKeys.all });
    },
    onError: () => {
      toast.error("Couldn't update the issue report.");
    },
  });
}
