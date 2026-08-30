import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";

export interface CreateIssueReportParams {
  type: "bug" | "suggestion";
  title: string;
  description: string;
  pagePath: string;
  appVersion: string;
  reporterRole: string | null;
}

/**
 * Files a bug/suggestion report from anywhere in the app. Available to
 * every authenticated role (magistrate, clerk, admin) — RLS only lets a
 * caller insert a row with their own `reporter_id`, so this can't be used
 * to report on someone else's behalf.
 */
export function useCreateIssueReport() {
  return useMutation({
    mutationFn: async ({
      type,
      title,
      description,
      pagePath,
      appVersion,
      reporterRole,
    }: CreateIssueReportParams) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in.");

      const { error } = await supabase.from("issue_reports").insert({
        reporter_id: user.id,
        type,
        title: title.trim(),
        description: description.trim(),
        page_path: pagePath,
        app_version: appVersion,
        reporter_role: reporterRole,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      toast.success(
        variables.type === "bug" ? "Bug report sent. Thank you." : "Suggestion sent. Thank you.",
      );
    },
    onError: () => {
      toast.error("Couldn't send your report. Please try again.");
    },
  });
}
