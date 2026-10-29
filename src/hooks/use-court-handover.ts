import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { checkRpc } from "@/lib/rpc-results";
import type { RelinquishPreflight } from "@/lib/court-handover";
import { getErrorMessage } from "@/lib/utils";

export const courtHandoverKeys = {
  preflight: (assignmentId: string) => ["court-handover", "preflight", assignmentId] as const,
};

/**
 * What ending a court assignment leaves behind (relinquish_preflight, 0220):
 * part-heard matters not yet retained, and the judgment pins there, with
 * the ones that will be unlinked. Read-only; open to the assignment's
 * magistrate and to administrators, who get ids, statuses and dates only.
 * Errors are shown in the dialog (preflightErrorMessage), not toasted.
 */
export function useRelinquishPreflight(assignmentId: string | null) {
  return useQuery({
    queryKey: courtHandoverKeys.preflight(assignmentId ?? ""),
    queryFn: async (): Promise<RelinquishPreflight> => {
      const { data, error } = await supabase.rpc("relinquish_preflight", {
        p_assignment_id: assignmentId as string,
      });
      if (error) throw error;
      return checkRpc("relinquish_preflight", data) as RelinquishPreflight;
    },
    enabled: !!assignmentId,
    retry: false,
    meta: { silent: true },
  });
}

/**
 * Retain one part-heard matter from the pre-flight: the caller's own
 * retained assignment (the self-only `docket_matter_assignments` insert,
 * 0022), so they keep access after the court assignment ends.
 */
export function useRetainPartHeardMatter(assignmentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (matterId: string) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in.");
      const { error } = await supabase.from("docket_matter_assignments").insert({
        docket_matter_id: matterId,
        profile_id: user.id,
        granted_by: user.id,
        reason: "retained_part_heard",
        notes: null,
      });
      if (error) throw error;
    },
    onSuccess: (_result, matterId) => {
      toast.success("Matter retained.");
      void queryClient.invalidateQueries({ queryKey: courtHandoverKeys.preflight(assignmentId) });
      void queryClient.invalidateQueries({ queryKey: ["docket-assignments", matterId] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard", "my-retained-matters"] });
      void queryClient.invalidateQueries({ queryKey: ["docket-matters"] });
      void queryClient.invalidateQueries({ queryKey: ["docket-matter-access", matterId] });
    },
    meta: { silent: true },
    onError: (error) => toast.error(getErrorMessage(error)),
  });
}
