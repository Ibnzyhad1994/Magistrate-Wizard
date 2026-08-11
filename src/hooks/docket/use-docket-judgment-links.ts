import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";

/**
 * Docket-initiated write side of the already-applied `docket_matter_judgments`
 * table (0029). The read side for both directions already existed
 * (`useLinkedJudgments` here, `useJudgmentDocketMatters` on the Judgment
 * side) but neither side could actually CREATE a link, despite both
 * empty states claiming the other workspace could. No schema/RLS change.
 *
 * Unlike `docket_matter_case_law` (read-access-only predicate), this
 * table's live INSERT/DELETE policies require lawful Docket access
 * (current Court or retained assignment) AND JUDGMENT OWNERSHIP
 * specifically (`j.owner_id = auth.uid()`) — `is_discoverable` alone is
 * never sufficient. That is a deliberate, documented asymmetry (see
 * 0029's own comments) and is NOT changed here. Concretely: a magistrate
 * can only link/unlink Judgments they own, even though they may be able
 * to VIEW other magistrates' discoverable Judgments elsewhere. The
 * picker (`LinkJudgmentDialog`) filters to owned Judgments client-side
 * for a clean UX, and the server re-checks ownership regardless.
 */

/** Link a Judgment (owned by the caller) to this Docket Matter as reference material. */
export function useCreateDocketJudgmentLink(matterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (judgmentId: string) => {
      const { error } = await supabase.from("docket_matter_judgments").insert({
        docket_matter_id: matterId,
        judgment_id: judgmentId,
      });
      if (error) throw error;
      return judgmentId;
    },
    onSuccess: (judgmentId) => {
      toast.success("Judgment linked.");
      void queryClient.invalidateQueries({ queryKey: ["docket-linked-judgments", matterId] });
      // Lets the Judgment's own "Linked Docket Matters" card (a separate
      // query key) reflect this immediately if it's cached/open.
      void queryClient.invalidateQueries({ queryKey: ["judgment-docket-matters", judgmentId] });
    },
  });
}

/**
 * Unlink a Judgment from this Docket Matter — deletes only the
 * association row. Neither record is touched. Same ownership-plus-access
 * predicate as creation governs who may unlink (see file header).
 */
export function useDeleteDocketJudgmentLink(matterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { linkId: string; judgmentId: string }) => {
      const { error } = await supabase
        .from("docket_matter_judgments")
        .delete()
        .eq("id", input.linkId);
      if (error) throw error;
      return input;
    },
    onSuccess: ({ judgmentId }) => {
      toast.success("Judgment unlinked.");
      void queryClient.invalidateQueries({ queryKey: ["docket-linked-judgments", matterId] });
      void queryClient.invalidateQueries({ queryKey: ["judgment-docket-matters", judgmentId] });
    },
  });
}
