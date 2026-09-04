import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { canRestoreJudgmentVersion } from "@/lib/judgment-versions";
import type { Json } from "@/types/database.types";
import { judgmentsKeys, judgmentVersionsKeys } from "@/hooks/judgments/use-judgments";

export function useJudgmentVersions(judgmentId: string | undefined) {
  return useQuery({
    queryKey: judgmentVersionsKeys.list(judgmentId ?? ""),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("judgment_versions")
        .select(
          "id, judgment_id, version_number, title, case_number, citation, court_name, judgment_date, content, content_text, created_at, created_by",
        )
        .eq("judgment_id", judgmentId as string)
        .order("version_number", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!judgmentId,
  });
}

export function useRestoreJudgmentVersion(judgmentId: string, status: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (version: {
      title: string;
      case_number: string | null;
      citation: string | null;
      court_name: string | null;
      judgment_date: string | null;
      content: Json | null;
      content_text: string | null;
    }) => {
      if (!canRestoreJudgmentVersion(status)) {
        throw new Error("Unlock this judgment to a draft before restoring a previous version.");
      }
      const { error } = await supabase
        .from("judgments")
        .update({
          title: version.title,
          case_number: version.case_number,
          citation: version.citation,
          court_name: version.court_name,
          judgment_date: version.judgment_date,
          content: version.content,
          content_text: version.content_text ?? "",
        })
        .eq("id", judgmentId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Version restored.");
      void queryClient.invalidateQueries({ queryKey: judgmentsKeys.detail(judgmentId) });
      void queryClient.invalidateQueries({ queryKey: judgmentsKeys.all });
      void queryClient.invalidateQueries({ queryKey: judgmentVersionsKeys.list(judgmentId) });
    },
  });
}
